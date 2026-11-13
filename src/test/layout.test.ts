import { describe, expect, it } from "vitest";
import { hidesSiteChrome } from "@/lib/layout";

describe("site navbar/footer visibility", () => {
  it.each(["/seller", "/seller/", "/seller/orders", "/seller/settings"])(
    "hidden on the seller dashboard: %s",
    (path) => expect(hidesSiteChrome(path)).toBe(true),
  );
  it.each([
    "/",
    "/products",
    "/store/nextgen-tech",
    "/account",
    "/admin",
    "/sellers",
    "/seller-guide",
  ])("shown on %s", (path) => expect(hidesSiteChrome(path)).toBe(false));
});
