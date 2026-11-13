import { z } from "zod";
import type { CarrierRow, ShipmentEventRow, ShipmentRow } from "@/data/db";
import { supabase } from "@/lib/supabase";
import {
  SHIPMENT_STATUSES,
  TRACKING_NUMBER_PLACEHOLDER,
  fillTrackingTemplate,
  sortEvents,
} from "@/lib/tracking";
import { expectRows, friendlyError } from "./errors";

// ---------------------------------------------------------------------------
// Validation (mirrors the database rules so the form can explain them)
// ---------------------------------------------------------------------------
const blank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");

export const trackingNumberSchema = z
  .string({ required_error: "Enter the tracking number." })
  .trim()
  .min(4, "Tracking numbers have at least 4 characters.")
  .max(64, "Tracking numbers have at most 64 characters.")
  .regex(
    /^[A-Za-z0-9 ._/-]+$/,
    "Use only letters, numbers, spaces and . _ / - in the tracking number.",
  );

const optionalHttpsUrl = z.preprocess(
  (v) => (blank(v) ? null : v),
  z
    .string()
    .trim()
    .max(2048)
    .refine((s) => /^https:\/\/[^\s]+$/i.test(s), "The tracking link must start with https://")
    .refine((s) => {
      try {
        return new URL(s).protocol === "https:";
      } catch {
        return false;
      }
    }, "That tracking link isn't a valid web address.")
    .nullable(),
);

const optionalText = (max: number) =>
  z.preprocess((v) => (blank(v) ? null : v), z.string().trim().max(max).nullable());

/** Carrier is either a known carrier (id) or a free-text name ("Other"). */
const carrierChoice = z
  .object({
    carrier_id: z.preprocess((v) => (blank(v) ? null : v), z.string().uuid().nullable()),
    carrier_name: optionalText(80),
  })
  .refine((c) => !!c.carrier_id || !!c.carrier_name, {
    path: ["carrier_name"],
    message: "Choose a carrier or type its name.",
  });

export const shipmentInputSchema = z
  .object({
    tracking_number: trackingNumberSchema,
    tracking_url: optionalHttpsUrl,
    status: z.enum(SHIPMENT_STATUSES).default("in_transit"),
  })
  .and(carrierChoice);
export type ShipmentInput = z.input<typeof shipmentInputSchema>;

export const shipmentEditSchema = z
  .object({ tracking_number: trackingNumberSchema, tracking_url: optionalHttpsUrl })
  .and(carrierChoice);
export type ShipmentEdit = z.input<typeof shipmentEditSchema>;

export const shipmentUpdateSchema = z.object({
  status: z.enum(SHIPMENT_STATUSES, {
    errorMap: () => ({ message: "Choose a status." }),
  }),
  description: optionalText(500),
  location: optionalText(120),
});
export type ShipmentUpdateInput = z.input<typeof shipmentUpdateSchema>;

export const carrierInputSchema = z.object({
  name: z.string().trim().min(2, "Name needs at least 2 characters.").max(80),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Code needs at least 2 characters.")
    .max(32)
    .regex(/^[a-z0-9_-]+$/, "Use only a–z, 0–9, _ and - in the code."),
  tracking_url_template: z
    .string()
    .trim()
    .max(2048)
    .refine((s) => /^https:\/\//i.test(s), "The template must start with https://")
    .refine(
      (s) => s.includes(TRACKING_NUMBER_PLACEHOLDER),
      `The template must contain ${TRACKING_NUMBER_PLACEHOLDER} where the tracking number goes.`,
    )
    .refine(
      (s) => !!fillTrackingTemplate(s, "TEST123"),
      "That template isn't a valid web address.",
    ),
  is_active: z.boolean().default(true),
});
export type CarrierInput = z.input<typeof carrierInputSchema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
/**
 * Shipping errors in plain words. Missing tables/functions show the real
 * database message (the tracking migration may not be applied yet); the
 * server's own rule messages (cancelled order, unpaid, delivered) pass through.
 */
export function shippingError(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code && ["PGRST205", "PGRST202", "PGRST200", "42P01", "42883"].includes(err.code))
    return `Shipment tracking isn't set up in the database yet: ${err.message ?? err.code}`;
  return friendlyError(e, {
    "23505": "This tracking number is already added to this order",
    "23514": "That value isn't allowed for a shipment.",
    "42501": "You don't have permission to change this shipment.",
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Shipment = ShipmentRow & {
  carriers: CarrierRow | null;
  /** Newest first. */
  shipment_events: ShipmentEventRow[];
};

const SHIPMENT_SELECT = "*, carriers(*), shipment_events(*)";

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export const shippingService = {
  /** Active carriers for the seller's picker (public read). */
  activeCarriers: async (): Promise<CarrierRow[]> => {
    const { data, error } = await supabase
      .from("carriers")
      .select("*")
      .eq("is_active", true)
      .order("name");
    if (error) throw error;
    return data as CarrierRow[];
  },

  /** Shipments (with carrier and events) for the given orders; RLS limits visibility. */
  forOrders: async (orderIds: string[]): Promise<Shipment[]> => {
    if (!orderIds.length) return [];
    const { data, error } = await supabase
      .from("shipments")
      .select(SHIPMENT_SELECT)
      .in("order_id", orderIds)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data as Shipment[]).map((s) => ({
      ...s,
      shipment_events: sortEvents(s.shipment_events ?? []),
    }));
  },

  /** Adds a shipment. Only the allowed insert columns are ever sent. */
  add: async (orderId: string, input: ShipmentInput): Promise<ShipmentRow> => {
    const v = shipmentInputSchema.parse(input);
    const { data, error } = await supabase
      .from("shipments")
      .insert({
        order_id: orderId,
        carrier_id: v.carrier_id,
        carrier_name: v.carrier_id ? null : v.carrier_name,
        tracking_number: v.tracking_number,
        tracking_url: v.tracking_url,
        status: v.status,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data as ShipmentRow;
  },

  /** Edits carrier / number / link. Never touches status (the database refuses it). */
  edit: async (shipmentId: string, input: ShipmentEdit): Promise<void> => {
    const v = shipmentEditSchema.parse(input);
    const { data, error } = await supabase
      .from("shipments")
      .update({
        carrier_id: v.carrier_id,
        carrier_name: v.carrier_id ? null : v.carrier_name,
        tracking_number: v.tracking_number,
        tracking_url: v.tracking_url,
      })
      .eq("id", shipmentId)
      .select("id");
    if (error) throw error;
    expectRows(data, "shipment");
  },

  /** The only way to change a status: adds a timeline entry via the database function. */
  addUpdate: async (shipmentId: string, input: ShipmentUpdateInput): Promise<void> => {
    const v = shipmentUpdateSchema.parse(input);
    const { error } = await supabase.rpc("add_shipment_update", {
      p_shipment_id: shipmentId,
      p_status: v.status,
      p_description: v.description,
      p_location: v.location,
    });
    if (error) throw error;
  },
};

/** Admin: carriers (only admins can write; RLS enforces it). */
export const carriersService = {
  listAll: async (): Promise<CarrierRow[]> => {
    const { data, error } = await supabase.from("carriers").select("*").order("name");
    if (error) throw error;
    return data as CarrierRow[];
  },
  create: async (input: CarrierInput): Promise<void> => {
    const v = carrierInputSchema.parse(input);
    const { error } = await supabase.from("carriers").insert(v);
    if (error) throw error;
  },
  update: async (id: string, input: CarrierInput): Promise<void> => {
    const v = carrierInputSchema.parse(input);
    const { data, error } = await supabase.from("carriers").update(v).eq("id", id).select("id");
    if (error) throw error;
    expectRows(data, "carrier");
  },
  /** Carriers are never deleted (shipments may use them); they are disabled instead. */
  setActive: async (id: string, is_active: boolean): Promise<void> => {
    const { data, error } = await supabase
      .from("carriers")
      .update({ is_active })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    expectRows(data, "carrier");
  },
};

export const carrierError = (e: unknown) => {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code && ["PGRST205", "42P01"].includes(err.code))
    return `Carriers aren't set up in the database yet: ${err.message ?? err.code}`;
  return friendlyError(e, { "23505": "A carrier with this code already exists." });
};
