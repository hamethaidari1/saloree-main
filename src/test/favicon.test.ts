import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SITE_ICON_LINKS, SITE_LOGO_SQUARE, SITE_THEME_COLOR } from "@/lib/brand";
import { organizationLd } from "@/lib/seo";

const file = (path: string) => readFileSync(join(process.cwd(), "public", path.replace(/^\//, "")));

/** Width, height and colour type from a PNG's header. */
function png(buf: Buffer) {
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

describe("site icons (Google search result icon)", () => {
  it("declares the icons with fixed root URLs and no query strings", () => {
    for (const link of SITE_ICON_LINKS) {
      expect(link.href).toMatch(/^\/[a-z0-9.-]+$/);
      expect(file(link.href).length).toBeGreaterThan(0);
    }
    expect(SITE_ICON_LINKS.filter((l) => l.rel === "icon").map((l) => l.href)).toEqual([
      "/favicon.ico",
      "/favicon-48x48.png",
      "/favicon-96x96.png",
      "/icon-192.png",
    ]);
  });

  it("every PNG icon is square, the size it says, a multiple of 48 (or 180 for Apple) and opaque", () => {
    const sizes: Record<string, number> = {
      "/favicon-48x48.png": 48,
      "/favicon-96x96.png": 96,
      "/icon-192.png": 192,
      "/icon-512.png": 512,
      "/apple-touch-icon.png": 180,
    };
    for (const [path, size] of Object.entries(sizes)) {
      const p = png(file(path));
      expect(p, path).toMatchObject({ width: size, height: size });
      // Colour type 2 = RGB, no alpha channel: never invisible on a white or dark page.
      expect(p.colorType, path).toBe(2);
    }
  });

  it("favicon.ico holds 48, 32 and 16 px images", () => {
    const ico = file("/favicon.ico");
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16]);
    expect(sizes).toEqual([48, 32, 16]);
  });

  it("the web manifest names Saloree with the 192 and 512 icons", () => {
    const manifest = JSON.parse(file("/site.webmanifest").toString("utf8")) as {
      name: string;
      theme_color: string;
      background_color: string;
      icons: { src: string; sizes: string }[];
    };
    expect(manifest).toMatchObject({
      name: "Saloree",
      theme_color: SITE_THEME_COLOR,
      background_color: SITE_THEME_COLOR,
    });
    expect(manifest.icons.map((i) => [i.src, i.sizes])).toEqual([
      ["/icon-192.png", "192x192"],
      ["/icon-512.png", "512x512"],
    ]);
  });

  it("the Organization logo is the square 512 px icon, as an absolute URL", () => {
    const ld = organizationLd({
      origin: "https://www.saloree.com",
      logo: SITE_LOGO_SQUARE,
      sameAs: [],
    });
    expect(ld.logo).toBe("https://www.saloree.com/icon-512.png");
  });

  it("robots.txt doesn't block any icon", () => {
    const disallowed = file("/robots.txt")
      .toString("utf8")
      .split("\n")
      .filter((l) => l.startsWith("Disallow:"))
      .map((l) => l.slice("Disallow:".length).trim());
    for (const link of [...SITE_ICON_LINKS, { href: SITE_LOGO_SQUARE }])
      for (const rule of disallowed)
        if (!rule.includes("*"))
          expect(link.href.startsWith(rule), `${link.href} vs ${rule}`).toBe(false);
  });
});
