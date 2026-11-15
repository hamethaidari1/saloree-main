import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AttachmentMime, SenderRole } from "@/lib/support";
import {
  supportErrorText,
  supportKeys,
  supportService,
  type SupportMessage,
} from "@/services/support";
import type { SupportT } from "./support-text";
import { refreshSupport } from "./use-support";

/** Who wrote it, from the reader's side. Staff are always "Saloree team". */
export function senderLabel(
  role: SenderRole,
  viewer: SenderRole,
  t: SupportT,
  customerName?: string | null,
) {
  if (role === "staff") return viewer === "staff" ? "Saloree team" : t("team");
  return viewer === "user" ? t("you") : customerName || "Customer";
}

// ---------------------------------------------------------------------------
// Sending: shown at once, with a failed/retry state
// ---------------------------------------------------------------------------
export interface PendingMessage {
  clientId: string;
  body: string;
  file: File | null;
  uploaded: { path: string; mime: AttachmentMime } | null;
  status: "sending" | "failed";
  error: string | null;
  /** The id send_support_message returned; dropped once that message is listed. */
  serverId: string | null;
  createdAt: string;
}

/** Pending messages that are not in the list yet. */
export const stillPending = (pending: PendingMessage[], messages: SupportMessage[]) => {
  const ids = new Set(messages.map((m) => m.id));
  return pending.filter((p) => !p.serverId || !ids.has(p.serverId));
};

export function useSender(threadId: string) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const update = (clientId: string, patch: Partial<PendingMessage>) =>
    setPending((all) => all.map((p) => (p.clientId === clientId ? { ...p, ...patch } : p)));

  const run = async (p: PendingMessage) => {
    update(p.clientId, { status: "sending", error: null });
    try {
      // On retry, an image that was already uploaded isn't uploaded again.
      const uploaded =
        p.uploaded ?? (p.file ? await supportService.uploadAttachment(threadId, p.file) : null);
      if (uploaded) update(p.clientId, { uploaded });
      const serverId = await supportService.sendMessage({
        threadId,
        body: p.body,
        attachment: uploaded,
      });
      update(p.clientId, { serverId });
      await Promise.all([
        qc.invalidateQueries({ queryKey: supportKeys.messages(threadId) }),
        refreshSupport(qc),
      ]);
    } catch (e) {
      update(p.clientId, { status: "failed", error: supportErrorText(e) });
    }
  };

  const send = (body: string, file: File | null) => {
    const p: PendingMessage = {
      clientId: crypto.randomUUID(),
      body,
      file,
      uploaded: null,
      status: "sending",
      error: null,
      serverId: null,
      createdAt: new Date().toISOString(),
    };
    setPending((all) => [...all, p]);
    return run(p);
  };
  const retry = (clientId: string) => {
    const p = pending.find((x) => x.clientId === clientId);
    if (p) void run(p);
  };
  const discard = (clientId: string) =>
    setPending((all) => all.filter((p) => p.clientId !== clientId));
  return {
    pending,
    send,
    retry,
    discard,
    sending: pending.some((p) => p.status === "sending" && !p.serverId),
  };
}
