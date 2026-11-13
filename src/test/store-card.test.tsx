import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithRouter } from "./router-harness";
import type { Store } from "@/data/catalog";
import { StoreCard } from "@/components/marketplace/store-card";
import { storeAddressLabel } from "@/lib/host";

const store = (patch: Partial<Store> = {}): Store => ({
  id: "s1",
  slug: "alizada",
  name: "Alizada Trends",
  initials: "at",
  description: "",
  rating: 0,
  specialty: "Electronics",
  image: "",
  logo: null,
  banner: null,
  tone: "rose",
  ...patch,
});

async function renderCard(s: Store) {
  const view = renderWithRouter(<StoreCard store={s} />);
  const link = await screen.findByRole("link");
  return { ...view, link };
}

describe("StoreCard", () => {
  it("is one link holding banner, badge, name, category and address (no nested link)", async () => {
    const { link, container } = await renderCard(
      store({ banner: "https://x.supabase.co/banner.jpg" }),
    );
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(link).toHaveAttribute("href", "/store/alizada");
    expect(link.querySelector(".store-card-banner img")).toHaveAttribute("loading", "lazy");
    expect(link.querySelector(".store-card-banner img")).toHaveAttribute("width", "640");
    expect(link.querySelector(".store-card-banner img")).toHaveAttribute("height", "360");
    expect(link.querySelector(".store-card-name")?.textContent).toBe("Alizada Trends");
    expect(link.querySelector(".store-card-category")?.textContent).toBe("Electronics");
    expect(link.querySelector(".store-card-address")?.textContent).toBe(
      storeAddressLabel("alizada"),
    );
    expect(link).toHaveAttribute("data-banner", "image");
  });

  it("shows a neutral fallback with the initials when there is no banner", async () => {
    const { link } = await renderCard(store());
    expect(link).toHaveAttribute("data-banner", "fallback");
    const fallback = screen.getByTestId("store-banner-fallback");
    expect(fallback.textContent).toBe("at");
    expect(link.querySelector(".store-card-banner img")).toBeNull();
  });

  it("switches to the fallback (with the logo) when the banner fails to load", async () => {
    const { link } = await renderCard(
      store({ banner: "https://x.supabase.co/broken.jpg", logo: "https://x.supabase.co/logo.png" }),
    );
    fireEvent.error(link.querySelector(".store-card-banner img")!);
    expect(link).toHaveAttribute("data-banner", "fallback");
    const fallback = screen.getByTestId("store-banner-fallback");
    expect(fallback.querySelector("img")).toHaveAttribute("src", "https://x.supabase.co/logo.png");
  });

  it("falls back to initials when the logo fails, keeping the same badge size class", async () => {
    const { link } = await renderCard(store({ logo: "https://x.supabase.co/broken-logo.png" }));
    const badge = link.querySelector(".store-card-body .store-badge")!;
    expect(badge).toHaveClass("store-badge-md");
    fireEvent.error(badge.querySelector("img")!);
    expect(badge.querySelector("img")).toBeNull();
    expect(badge.textContent).toBe("at");
  });

  it("keeps long names and addresses on one line with the full text in a title", async () => {
    const slug = "e2e-status-store-1789722727315";
    const name = "The Extraordinarily Long Named Independent Store Of Handmade Things";
    const { link } = await renderCard(store({ slug, name }));
    const nameEl = link.querySelector(".store-card-name")!;
    expect(nameEl).toHaveAttribute("title", name);
    const address = link.querySelector(".store-card-address")!;
    const label = storeAddressLabel(slug);
    expect(address).toHaveAttribute("title", label);
    expect(address.textContent).toBe(label);
    expect(label).not.toMatch(/^https?:\/\//);
    expect(label).toContain(slug);
  });
});

describe("storeAddressLabel", () => {
  it("shows the subdomain without https://", () => {
    const cfg = { rootDomain: "saloree.com", dev: false };
    expect(storeAddressLabel("e2e-status-store-1789722727315", cfg)).toBe(
      "e2e-status-store-1789722727315.saloree.com",
    );
    expect(storeAddressLabel("my-shop", { rootDomain: "", dev: false })).toBe("/store/my-shop");
  });
});
