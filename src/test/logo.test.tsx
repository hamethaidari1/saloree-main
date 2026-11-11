import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo } from "@/components/marketplace/logo";
import { LOGO, LOGO_ON_DARK } from "@/lib/brand";

describe("Saloree logo", () => {
  it.each([
    ["red (light surfaces)", LOGO],
    ["white (header)", LOGO_ON_DARK],
  ])("%s is served from /public with the declared dimensions and transparency", (_, logo) => {
    const file = readFileSync(resolve(__dirname, "../../public", logo.src.slice(1)));
    expect(file.subarray(1, 4).toString()).toBe("PNG");
    expect(file.readUInt32BE(16)).toBe(logo.width);
    expect(file.readUInt32BE(20)).toBe(logo.height);
    expect(file[25]).toBe(6); // RGBA
  });

  it("header variant uses the white wordmark", () => {
    render(<Logo onDark />);
    expect(screen.getByRole("img", { name: "Saloree" })).toHaveAttribute("src", "/logo-white.png");
  });

  it("renders one img with alt text and size matching the file's ratio", () => {
    render(<Logo />);
    const img = screen.getByRole("img", { name: "Saloree" });
    expect(img.getAttribute("src")).toBe("/logo.png");
    const w = Number(img.getAttribute("width"));
    const h = Number(img.getAttribute("height"));
    expect(w).toBeGreaterThan(0);
    expect(Math.abs(w / h - LOGO.width / LOGO.height)).toBeLessThan(0.05);
  });

  it("never points at a host-specific asset path", () => {
    for (const logo of [LOGO, LOGO_ON_DARK]) expect(logo.src).not.toMatch(/__l5e|^https?:/);
  });

  it("lazy-loads in the footer only", () => {
    const { container } = render(
      <>
        <Logo />
        <Logo lazy />
      </>,
    );
    const [header, footer] = container.querySelectorAll("img");
    expect(header?.getAttribute("loading")).toBeNull();
    expect(footer?.getAttribute("loading")).toBe("lazy");
  });
});
