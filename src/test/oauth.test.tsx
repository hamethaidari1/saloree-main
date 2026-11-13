import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { createSupabaseMock } from "./supabase-mock";
import { renderWithRouter } from "./router-harness";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import { homeForRoles, safeReturnTo } from "@/lib/redirects";
import { safeRedirect } from "@/lib/auth";
import {
  completeOAuthSignIn,
  destinationAfterSignIn,
  errorFromCallbackUrl,
  parseSavedOAuth,
  saveOAuth,
  startGoogleSignIn,
  takeSavedOAuth,
} from "@/lib/oauth";
import { OAuthCallbackView } from "@/components/marketplace/oauth-callback";
import { GoogleButton } from "@/components/marketplace/google-button";
import { firstName } from "@/components/marketplace/header/account-menu";

const m = () => mock.current!;
const ORIGIN = window.location.origin;
beforeEach(() => {
  m().reset();
  sessionStorage.clear();
});

describe("safeReturnTo (open-redirect guard)", () => {
  it.each(["/", "/account", "/seller/orders?status=pending", "/account#my-orders", "/a/b%2Fc"])(
    "accepts %j",
    (v) => expect(safeReturnTo(v)).toBe(v),
  );
  it.each([
    "//evil.com",
    "///evil.com",
    "https://evil.com",
    "http://evil.com",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,x",
    "/\\evil.com",
    "\\\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    " /account",
    "account",
    "",
    null,
    undefined,
    42,
    {},
    `/${"a".repeat(3000)}`,
  ])("rejects %j", (v) => expect(safeReturnTo(v)).toBeNull());

  it("is what ?redirect= on the login page uses", () => {
    expect(safeRedirect("//evil.com", "/account")).toBe("/account");
    expect(safeRedirect("/seller", "/account")).toBe("/seller");
  });
});

describe("role-based destination", () => {
  it.each([
    [["admin"], "/admin"],
    [["content_admin"], "/admin/marketplace"],
    [["finance_admin"], "/admin/finance"],
    [["seller"], "/seller"],
    [["customer"], "/account"],
    [[], "/account"],
    [["seller", "admin"], "/admin"],
    [["customer", "seller"], "/seller"],
    [["finance_admin", "content_admin"], "/admin/marketplace"],
  ])("%j → %s", (roles, path) => expect(homeForRoles(roles)).toBe(path));

  it("a valid returnTo wins over the role; a seller intent always goes to /seller", () => {
    expect(destinationAfterSignIn({ returnTo: "/cart", intent: "customer" }, ["admin"])).toBe(
      "/cart",
    );
    expect(destinationAfterSignIn({ returnTo: null, intent: "customer" }, ["seller"])).toBe(
      "/seller",
    );
    expect(destinationAfterSignIn({ returnTo: "/cart", intent: "seller" }, [])).toBe("/seller");
  });
});

describe("saved intent (sessionStorage)", () => {
  it("round-trips once, then is gone", () => {
    saveOAuth({ returnTo: "/checkout", intent: "seller" });
    expect(takeSavedOAuth()).toEqual({ returnTo: "/checkout", intent: "seller" });
    expect(takeSavedOAuth()).toEqual({ returnTo: null, intent: "customer" });
  });
  it("never trusts what is stored", () => {
    expect(parseSavedOAuth('{"returnTo":"//evil.com","intent":"admin"}')).toEqual({
      returnTo: null,
      intent: "customer",
    });
    expect(parseSavedOAuth("not json")).toEqual({ returnTo: null, intent: "customer" });
    expect(parseSavedOAuth(null)).toEqual({ returnTo: null, intent: "customer" });
  });
  it("drops an unsafe returnTo before saving", () => {
    saveOAuth({ returnTo: "https://evil.com", intent: "customer" });
    expect(JSON.parse(sessionStorage.getItem("saloree.oauth")!)).toEqual({
      returnTo: null,
      intent: "customer",
    });
  });
});

describe("starting Google sign-in", () => {
  it("saves intent + returnTo and calls signInWithOAuth with the callback and account picker", async () => {
    await startGoogleSignIn({ returnTo: "/cart", intent: "seller" });
    expect(m().state.oauthCalls).toEqual([
      {
        provider: "google",
        options: {
          redirectTo: `${ORIGIN}/auth/callback`,
          queryParams: { prompt: "select_account" },
        },
      },
    ]);
    expect(takeSavedOAuth()).toEqual({ returnTo: "/cart", intent: "seller" });
  });

  it("the button shows a spinner and disables itself while redirecting", async () => {
    renderWithRouter(<GoogleButton intent="seller" />);
    const button = await screen.findByRole("button", { name: /continue with google/i });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(button.textContent).toMatch(/redirecting to google/i);
    expect(JSON.parse(sessionStorage.getItem("saloree.oauth")!)).toMatchObject({
      intent: "seller",
    });
  });

  it("shows the real error if Supabase refuses to start", async () => {
    m().state.oauthError = { message: "Unsupported provider: provider is not enabled" };
    renderWithRouter(<GoogleButton />);
    fireEvent.click(await screen.findByRole("button", { name: /continue with google/i }));
    // Translated, with Supabase's real message kept for diagnosis.
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Google sign-in isn't available right now. (Unsupported provider: provider is not enabled)",
    );
    expect(screen.getByRole("button", { name: /continue with google/i })).not.toBeDisabled();
    expect(sessionStorage.getItem("saloree.oauth")).toBeNull();
  });
});

describe("completeOAuthSignIn (/auth/callback)", () => {
  it("exchanges the code and goes to the saved returnTo", async () => {
    saveOAuth({ returnTo: "/cart", intent: "customer" });
    m().state.queue.push({ data: [{ role: "customer" }] });
    expect(await completeOAuthSignIn(`${ORIGIN}/auth/callback?code=abc`)).toBe("/cart");
    expect(m().state.exchanges).toEqual(["abc"]);
    expect(m().state.rpcs).toEqual([]);
  });

  it("without returnTo goes by role", async () => {
    m().state.queue.push({ data: [{ role: "admin" }] });
    expect(await completeOAuthSignIn(`${ORIGIN}/auth/callback?code=abc`)).toBe("/admin");
  });

  it("seller intent calls become_seller() and goes to /seller", async () => {
    saveOAuth({ returnTo: null, intent: "seller" });
    m().state.queue.push({ data: null }, { data: [{ role: "seller" }] });
    expect(await completeOAuthSignIn(`${ORIGIN}/auth/callback?code=abc`)).toBe("/seller");
    expect(m().state.rpcs).toEqual([{ fn: "become_seller", args: undefined }]);
  });

  it("a missing become_seller() surfaces the real error (stage: seller)", async () => {
    saveOAuth({ returnTo: null, intent: "seller" });
    m().state.queue.push({
      error: { code: "PGRST202", message: "Could not find the function public.become_seller" },
    });
    await expect(completeOAuthSignIn(`${ORIGIN}/auth/callback?code=abc`)).rejects.toMatchObject({
      stage: "seller",
      code: "PGRST202",
      message: "Could not find the function public.become_seller",
    });
  });

  it("reads provider errors from the query or the #fragment", () => {
    expect(
      errorFromCallbackUrl(
        `${ORIGIN}/auth/callback?error=access_denied&error_description=The+user+denied+access`,
      ),
    ).toEqual({ message: "The user denied access", code: "access_denied" });
    expect(
      errorFromCallbackUrl(`${ORIGIN}/auth/callback#error=server_error&error_code=bad_oauth_state`),
    ).toEqual({ message: "bad_oauth_state", code: "bad_oauth_state" });
    expect(errorFromCallbackUrl(`${ORIGIN}/auth/callback?code=abc`)).toBeNull();
  });
});

describe("callback page error state", () => {
  it("shows the real message when the user cancelled at Google, with Back to sign in", async () => {
    renderWithRouter(
      <OAuthCallbackView
        href={`${ORIGIN}/auth/callback?error=access_denied&error_description=The+user+denied+access`}
      />,
    );
    const alert = await screen.findByTestId("oauth-error");
    expect(alert.textContent).toContain("You cancelled the sign-in at Google.");
    expect(alert.textContent).toContain("The user denied access (access_denied)");
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
    expect(m().state.exchanges).toEqual([]);
  });

  it("shows the real message when the code exchange fails", async () => {
    m().state.exchangeError = {
      message: "invalid request: both auth code and code verifier should be non-empty",
      code: "validation_failed",
    };
    renderWithRouter(<OAuthCallbackView href={`${ORIGIN}/auth/callback?code=used`} />);
    expect((await screen.findByTestId("oauth-error")).textContent).toContain(
      "both auth code and code verifier should be non-empty",
    );
    expect(screen.getByRole("heading").textContent).toMatch(/google sign-in didn't work/i);
  });

  it("explains a seller-setup failure separately (already signed in)", async () => {
    saveOAuth({ returnTo: null, intent: "seller" });
    m().state.queue.push({ error: { code: "PGRST202", message: "Could not find the function" } });
    renderWithRouter(<OAuthCallbackView href={`${ORIGIN}/auth/callback?code=abc`} />);
    expect((await screen.findByTestId("oauth-error")).textContent).toContain(
      "Could not find the function",
    );
    expect(screen.getByRole("heading").textContent).toMatch(/seller account/i);
    expect(screen.getByRole("link", { name: "Go to your account" })).toHaveAttribute(
      "href",
      "/account",
    );
  });

  it("redirects on success", async () => {
    m().state.queue.push({ data: [{ role: "seller" }] });
    const { router } = renderWithRouter(
      <OAuthCallbackView href={`${ORIGIN}/auth/callback?code=abc`} />,
      "/auth/callback",
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/seller"));
  });
});

describe("display name", () => {
  it("prefers profiles.full_name over the sign-in metadata", () => {
    const user = { email: "x@y.z", user_metadata: { full_name: "Google Name" } };
    expect(firstName(user, "Sara Ahmadi")).toBe("Sara");
    expect(firstName(user, null)).toBe("Google");
    expect(firstName({ email: "amir@x.io", user_metadata: {} }, null)).toBe("amir");
  });
});
