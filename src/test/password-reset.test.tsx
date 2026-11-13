import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { createSupabaseMock } from "./supabase-mock";
import { renderWithRouter } from "./router-harness";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import {
  cleanRecoveryUrl,
  cooldownLeft,
  emailSchema,
  fieldErrors,
  isShownSendError,
  newPasswordSchema,
  openRecoveryLink,
  PASSWORD_MIN_LENGTH,
  passwordResetRedirect,
  readRecoveryLink,
  requestPasswordReset,
  resetErrorKind,
  resetPasswordSchema,
  sessionAuthMethods,
  updatePassword,
} from "@/lib/password-reset";
import { hasRecoveryMark, isAuthRedirectUrl, markRecovery } from "@/lib/auth-url";
import { isMainOnlyPath, type HostConfig } from "@/lib/host";
import { ForgotPasswordView, ResetPasswordView } from "@/components/marketplace/password-reset";
import { Route as LoginRoute } from "@/routes/login";
import { Route as ForgotRoute } from "@/routes/forgot-password";
import { Route as ResetRoute } from "@/routes/reset-password";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";

/** The real login page in a small router (search validation included). */
function renderLogin(path: string) {
  const root = createRootRoute();
  const page = (p: string) => createRoute({ getParentRoute: () => root, path: p });
  const login = createRoute({
    getParentRoute: () => root,
    path: "/login",
    validateSearch: LoginRoute.options.validateSearch,
    component: LoginRoute.options.component!,
  });
  const router = createRouter({
    routeTree: root.addChildren([login, page("/forgot-password"), page("/register")]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return render(<RouterProvider router={router} />);
}

describe("sign-in page", () => {
  it("has 'Forgot password?' under the password field", async () => {
    renderLogin("/login");
    const link = await screen.findByRole("link", { name: "Forgot password?" });
    expect(link).toHaveAttribute("href", "/forgot-password");
    const password = screen.getByLabelText("Password");
    expect(password.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("shows 'Password updated, please sign in.' after a reset (announced politely)", async () => {
    renderLogin("/login?notice=password-updated");
    const notice = await screen.findByText("Password updated, please sign in.");
    expect(notice.closest("[role=status]")).toHaveAttribute("aria-live", "polite");
  });
  it("ignores unknown notices", async () => {
    renderLogin("/login?notice=<b>hi</b>");
    await screen.findByRole("link", { name: "Forgot password?" });
    expect(screen.queryByText(/Password updated/)).toBeNull();
  });
});

describe("route settings", () => {
  const meta = (route: { options: { head?: unknown } }) =>
    (route.options.head as (c: { matches: [] }) => { meta: Record<string, string>[] })({
      matches: [],
    }).meta;
  it("neither page can be indexed; the reset page is browser-only", () => {
    expect(meta(ForgotRoute)).toContainEqual({ name: "robots", content: "noindex" });
    expect(meta(ResetRoute)).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    expect(meta(ResetRoute)).toContainEqual({ name: "referrer", content: "no-referrer" });
    expect(ResetRoute.options.ssr).toBe(false);
  });
});

const m = () => mock.current!;
beforeEach(() => {
  m().reset();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

/** What supabase.ts does in the browser: remember a PASSWORD_RECOVERY event. */
function listenLikeTheClient() {
  m().supabase.auth.onAuthStateChange((event, session) => {
    const s = session as { user: { id: string } } | null;
    if (event === "PASSWORD_RECOVERY" && s) markRecovery(s.user.id);
  });
}

/** A JWT-shaped token whose payload carries `amr`. */
const tokenWithAmr = (...methods: string[]) =>
  `x.${btoa(JSON.stringify({ amr: methods.map((method) => ({ method, timestamp: 1 })) }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")}.sig`;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
describe("schemas", () => {
  it("email: trimmed, lower-cased, required and well formed", () => {
    expect(emailSchema.parse("  Sara@Example.COM ")).toBe("sara@example.com");
    expect(emailSchema.safeParse("").error?.issues[0]?.message).toBe("required");
    expect(emailSchema.safeParse("   ").error?.issues[0]?.message).toBe("required");
    expect(emailSchema.safeParse("sara@").error?.issues[0]?.message).toBe("invalid");
    expect(emailSchema.safeParse("no-at-sign").success).toBe(false);
  });

  it("new password: the sign-up rule (at least 8 characters)", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(newPasswordSchema.safeParse("1234567").success).toBe(false);
    expect(newPasswordSchema.safeParse("12345678").success).toBe(true);
  });

  it("passwords must match; each field gets its own problem", () => {
    const r = (password: string, confirm: string) => {
      const parsed = resetPasswordSchema.safeParse({ password, confirm });
      return parsed.success ? {} : fieldErrors(parsed.error);
    };
    expect(r("", "")).toEqual({ password: "required" });
    expect(r("short", "short")).toEqual({ password: "tooShort" });
    expect(r("long enough", "long enougH")).toEqual({ confirm: "mismatch" });
    expect(r("long enough", "long enough")).toEqual({});
  });
});

describe("resend cooldown", () => {
  const t0 = 1_700_000_000_000;
  it("counts 60 whole seconds down to 0", () => {
    expect(cooldownLeft(null, t0)).toBe(0);
    expect(cooldownLeft(t0, t0)).toBe(60);
    expect(cooldownLeft(t0, t0 + 200)).toBe(60);
    expect(cooldownLeft(t0, t0 + 30_200)).toBe(30);
    expect(cooldownLeft(t0, t0 + 59_001)).toBe(1);
    expect(cooldownLeft(t0, t0 + 60_000)).toBe(0);
    expect(cooldownLeft(t0, t0 + 3_600_000)).toBe(0);
  });
  it("a clock that moved backwards never makes it longer than 60 s", () => {
    expect(cooldownLeft(t0, t0 - 500_000)).toBe(60);
    expect(cooldownLeft(Number.NaN, t0)).toBe(0);
  });
});

describe("error mapping", () => {
  it.each([
    [{ code: "over_email_send_rate_limit", message: "email rate limit exceeded" }, "rateLimit"],
    [
      {
        status: 429,
        message: "For security purposes, you can only request this after 42 seconds.",
      },
      "rateLimit",
    ],
    [{ message: "Email rate limit exceeded" }, "rateLimit"],
    [{ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }, "network"],
    [new TypeError("NetworkError when attempting to fetch resource."), "network"],
    [
      { code: "same_password", message: "New password should be different from the old password." },
      "samePassword",
    ],
    [
      {
        code: "weak_password",
        message: "Password should contain at least one character of each: abc",
        reasons: ["characters"],
      },
      "weakPassword",
    ],
    [
      {
        code: "weak_password",
        name: "AuthWeakPasswordError",
        message: "Password is known to be weak and easy to guess",
        reasons: ["pwned"],
      },
      "leakedPassword",
    ],
    [
      {
        code: "pkce_code_verifier_not_found",
        name: "AuthPKCECodeVerifierMissingError",
        message: "PKCE code verifier not found in storage.",
      },
      "otherBrowser",
    ],
    [{ code: "otp_expired", message: "Email link is invalid or has expired" }, "linkExpired"],
    [
      { code: "flow_state_not_found", message: "invalid flow state, no valid flow state found" },
      "linkExpired",
    ],
    [{ name: "AuthSessionMissingError", message: "Auth session missing!" }, "sessionMissing"],
    [{ code: "unexpected_failure", message: "Error sending recovery email" }, null],
    [null, null],
  ])("%j → %s", (error, kind) => expect(resetErrorKind(error)).toBe(kind));

  it("the send form shows only rate-limit and network problems", () => {
    expect(isShownSendError("rateLimit")).toBe(true);
    expect(isShownSendError("network")).toBe(true);
    for (const k of ["samePassword", "linkExpired", "otherBrowser", null] as const)
      expect(isShownSendError(k)).toBe(false);
  });
});

describe("reset link address (redirectTo)", () => {
  const prod = (origin?: string): HostConfig => ({ rootDomain: "saloree.com", dev: false, origin });
  it("production: always the main domain, even when asked from a store subdomain", () => {
    expect(passwordResetRedirect(prod("https://saloree.com"))).toBe(
      "https://saloree.com/reset-password",
    );
    expect(passwordResetRedirect(prod("https://alpha.saloree.com"))).toBe(
      "https://saloree.com/reset-password",
    );
    expect(passwordResetRedirect(prod())).toBe("https://saloree.com/reset-password");
  });
  it("dev: the current origin", () => {
    expect(
      passwordResetRedirect({
        rootDomain: "saloree.com",
        dev: true,
        origin: "http://localhost:8080",
      }),
    ).toBe("http://localhost:8080/reset-password");
  });
  it("no domain configured: the origin (no store subdomains exist); never empty", () => {
    expect(
      passwordResetRedirect({ rootDomain: "", dev: false, origin: "https://x.lovable.app" }),
    ).toBe("https://x.lovable.app/reset-password");
    expect(() => passwordResetRedirect({ rootDomain: "", dev: false })).toThrow();
  });
  it("both pages only exist on the main site", () => {
    expect(isMainOnlyPath("/forgot-password")).toBe(true);
    expect(isMainOnlyPath("/reset-password")).toBe(true);
  });
});

describe("reading the link", () => {
  it("finds a code, a token hash, an error or nothing", () => {
    expect(readRecoveryLink("https://saloree.com/reset-password?code=abc")).toEqual({
      kind: "code",
      code: "abc",
    });
    expect(
      readRecoveryLink("https://saloree.com/reset-password?token_hash=th&type=recovery"),
    ).toEqual({ kind: "token", tokenHash: "th" });
    expect(
      readRecoveryLink(
        "https://saloree.com/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
      ),
    ).toEqual({
      kind: "error",
      code: "otp_expired",
      message: "Email link is invalid or has expired",
    });
    expect(readRecoveryLink("https://saloree.com/reset-password")).toEqual({ kind: "none" });
  });
  it("removes one-time parameters from the address", () => {
    expect(cleanRecoveryUrl("https://saloree.com/reset-password?code=abc&lang=de#error=x")).toBe(
      "/reset-password?lang=de",
    );
  });
  it("reads the auth method from the access token", () => {
    expect(sessionAuthMethods(tokenWithAmr("recovery"))).toEqual(["recovery"]);
    expect(sessionAuthMethods(tokenWithAmr("password", "otp"))).toEqual(["password", "otp"]);
    expect(sessionAuthMethods("not-a-jwt")).toEqual([]);
    expect(sessionAuthMethods(undefined)).toEqual([]);
  });
  it("the client leaves error redirects on the auth pages to the page itself", () => {
    const at = (path: string) => new URL(`https://saloree.com${path}`);
    expect(isAuthRedirectUrl(at("/reset-password"), { error: "access_denied" })).toBe(false);
    expect(isAuthRedirectUrl(at("/auth/callback"), { access_token: "x" })).toBe(false);
    expect(isAuthRedirectUrl(at("/account"), { error_description: "x" })).toBe(true);
    // A normal page load is not a redirect (and ?code= is handled as PKCE).
    expect(isAuthRedirectUrl(at("/"), {})).toBe(false);
    expect(isAuthRedirectUrl(at("/account"), { code: "abc" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------
describe("calls", () => {
  const cfg: HostConfig = {
    rootDomain: "saloree.com",
    dev: false,
    origin: "https://a.saloree.com",
  };

  it("requests the email with the main-domain redirect", async () => {
    await requestPasswordReset(" Sara@Example.com ", cfg);
    expect(m().state.authCalls).toEqual([
      {
        fn: "resetPasswordForEmail",
        args: ["sara@example.com", { redirectTo: "https://saloree.com/reset-password" }],
      },
    ]);
  });
  it("passes real failures on; refuses an invalid address before calling", async () => {
    m().state.authErrors["resetPasswordForEmail"] = {
      code: "over_email_send_rate_limit",
      message: "email rate limit exceeded",
    };
    await expect(requestPasswordReset("a@b.co", cfg)).rejects.toMatchObject({
      code: "over_email_send_rate_limit",
    });
    await expect(requestPasswordReset("nope", cfg)).rejects.toThrow();
    expect(m().state.authCalls).toHaveLength(1);
  });

  it("sets the password, then signs this browser out of the recovery session", async () => {
    await updatePassword({ password: "new secret 1", confirm: "new secret 1" });
    expect(m().state.authCalls).toEqual([
      { fn: "updateUser", args: [{ password: "new secret 1" }] },
      { fn: "signOut", args: [{ scope: "local" }] },
    ]);
  });
  it("a refused password stays signed in for another try (no sign-out)", async () => {
    m().state.authErrors["updateUser"] = {
      code: "same_password",
      message: "New password should be different from the old password.",
    };
    await expect(
      updatePassword({ password: "old secret", confirm: "old secret" }),
    ).rejects.toMatchObject({ code: "same_password" });
    expect(m().state.authCalls.map((c) => c.fn)).toEqual(["updateUser"]);
    await expect(updatePassword({ password: "abcdefgh", confirm: "abcdefgX" })).rejects.toThrow();
    expect(m().state.authCalls).toHaveLength(1);
  });
});

describe("opening the recovery link", () => {
  it("expired / used link (Supabase redirect error) → friendly invalid state", async () => {
    const r = await openRecoveryLink(
      "https://saloree.com/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(r).toMatchObject({ status: "invalid", reason: "linkExpired" });
    expect(m().state.authCalls).toEqual([]); // nothing to exchange
  });

  it("?code= processed by the client → PASSWORD_RECOVERY → form", async () => {
    m().state.session = { user: { id: "u1", email: "sara@example.com" } };
    markRecovery("u1"); // what the client's PASSWORD_RECOVERY listener does
    const r = await openRecoveryLink("https://saloree.com/reset-password?code=abc");
    expect(r).toEqual({ status: "ready", email: "sara@example.com" });
    expect(m().state.authCalls.map((c) => c.fn)).toEqual(["initialize"]);
  });

  it("?code= this browser couldn't use (other browser / used) → explains, no form", async () => {
    m().state.session = null;
    expect(await openRecoveryLink("https://saloree.com/reset-password?code=abc")).toEqual({
      status: "invalid",
      reason: "otherBrowser",
    });
  });

  it("the client's own error while processing the code is shown", async () => {
    m().state.initError = { code: "flow_state_expired", message: "Flow state has expired" };
    expect(await openRecoveryLink("https://saloree.com/reset-password?code=abc")).toEqual({
      status: "invalid",
      reason: "linkExpired",
    });
  });

  it("token_hash link (works in any browser) is verified as a recovery", async () => {
    listenLikeTheClient();
    m().state.session = { user: { id: "u2", email: "omar@example.com" } };
    const r = await openRecoveryLink(
      "https://saloree.com/reset-password?token_hash=th&type=recovery",
    );
    expect(m().state.authCalls[1]).toEqual({
      fn: "verifyOtp",
      args: [{ type: "recovery", token_hash: "th" }],
    });
    expect(r).toEqual({ status: "ready", email: "omar@example.com" });
    expect(hasRecoveryMark("u2")).toBe(true);
  });

  it("an ordinary signed-in session is not a recovery session", async () => {
    m().state.session = { user: { id: "u3" }, access_token: tokenWithAmr("password") };
    expect(await openRecoveryLink("https://saloree.com/reset-password")).toEqual({
      status: "invalid",
      reason: "noLink",
    });
  });

  it("after a reload (code already removed) the recovery session still opens the form", async () => {
    m().state.session = { user: { id: "u4" }, access_token: tokenWithAmr("recovery") };
    expect(await openRecoveryLink("https://saloree.com/reset-password")).toMatchObject({
      status: "ready",
    });
  });
});

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
describe("/forgot-password page", () => {
  afterEach(() => vi.useRealTimers());

  const submit = (email: string) => {
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));
  };
  const NEUTRAL =
    /If an account exists for this email, we sent a reset link\. Check your inbox and spam folder\./;

  it("focuses the email field; invalid email → message, nothing sent", async () => {
    renderWithRouter(<ForgotPasswordView />);
    const email = await screen.findByLabelText("Email");
    expect(email).toHaveAttribute("autocomplete", "email");
    await waitFor(() => expect(document.activeElement).toBe(email));
    submit("sara@");
    expect(await screen.findByText("Enter a valid email address.")).toBeTruthy();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(m().state.authCalls).toEqual([]);
  });

  it("same neutral message whether or not the account exists; 60 s countdown", async () => {
    renderWithRouter(<ForgotPasswordView />);
    await screen.findByLabelText("Email");
    submit("someone@example.com");
    expect(await screen.findByText(NEUTRAL)).toBeTruthy();
    const button = screen.getByRole("button", { name: /send again in 60s/i });
    expect(button).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(NEUTRAL);
    expect(m().state.authCalls[0]!.args[0]).toBe("someone@example.com");
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
  });

  it("countdown runs and the button comes back", async () => {
    // Only the countdown's clock: React's own scheduling keeps real timers.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setInterval", "clearInterval", "Date"] });
    renderWithRouter(<ForgotPasswordView />);
    await screen.findByLabelText("Email");
    submit("someone@example.com");
    await screen.findByRole("button", { name: /send again in 60s/i });
    await act(async () => void vi.advanceTimersByTime(30_000));
    expect(screen.getByRole("button", { name: /send again in (30|29)s/i })).toBeDisabled();
    await act(async () => void vi.advanceTimersByTime(31_000));
    expect(screen.getByRole("button", { name: "Send reset link" })).not.toBeDisabled();
  });

  it("a server problem that could reveal the account still shows the neutral message", async () => {
    m().state.authErrors["resetPasswordForEmail"] = {
      code: "unexpected_failure",
      message: "Error sending recovery email",
      status: 500,
    };
    renderWithRouter(<ForgotPasswordView />);
    await screen.findByLabelText("Email");
    submit("google-only@example.com");
    expect(await screen.findByText(NEUTRAL)).toBeTruthy();
    expect(screen.queryByText(/Error sending recovery email/)).toBeNull();
  });

  it("rate limit → 'Please wait a minute and try again.' (announced)", async () => {
    m().state.authErrors["resetPasswordForEmail"] = {
      code: "over_email_send_rate_limit",
      status: 429,
      message: "email rate limit exceeded",
    };
    renderWithRouter(<ForgotPasswordView />);
    await screen.findByLabelText("Email");
    submit("a@b.co");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Please wait a minute and try again."),
    );
    expect(screen.queryByText(NEUTRAL)).toBeNull();
    expect(screen.getByRole("button", { name: /send again in/i })).toBeDisabled();
  });

  it("no connection → the network message", async () => {
    m().state.authErrors["resetPasswordForEmail"] = {
      name: "AuthRetryableFetchError",
      message: "Failed to fetch",
      status: 0,
    };
    renderWithRouter(<ForgotPasswordView />);
    await screen.findByLabelText("Email");
    submit("a@b.co");
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/couldn't reach Saloree/),
    );
    expect(screen.getByRole("button", { name: "Send reset link" })).not.toBeDisabled();
  });
});

describe("/reset-password page", () => {
  const openWith = async (path: string) => {
    window.history.replaceState(null, "", path);
    return renderWithRouter(<ResetPasswordView />, path);
  };
  const fill = (password: string, confirm: string) => {
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: confirm } });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
  };
  const asRecovery = () => {
    m().state.session = { user: { id: "u1", email: "sara@example.com" } };
    markRecovery("u1");
  };

  it("expired link → clear message + 'Request a new link', never a blank page", async () => {
    await openWith(
      "/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    expect(
      await screen.findByRole("heading", { name: "This reset link can't be used" }),
    ).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The link has expired or was already used.",
    );
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(window.location.hash).toBe(""); // error removed from the address
  });

  it("opened without a link → explains where to open it", async () => {
    m().state.session = null;
    await openWith("/reset-password");
    expect(
      await screen.findByText("Open this page from the link in your password reset email."),
    ).toBeTruthy();
  });

  it("recovery session → form with labels, autocomplete, focus and show/hide", async () => {
    asRecovery();
    await openWith("/reset-password?code=abc");
    const pw = await screen.findByLabelText("New password");
    expect(screen.getByText("For sara@example.com")).toBeTruthy();
    expect(pw).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    await waitFor(() => expect(document.activeElement).toBe(pw));
    expect(window.location.search).toBe(""); // one-time code removed
    expect(pw).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show passwords" }));
    expect(pw).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Hide passwords" }));
    expect(pw).toHaveAttribute("type", "password");
  });

  it("checks length and match before calling Supabase", async () => {
    asRecovery();
    await openWith("/reset-password?code=abc");
    await screen.findByLabelText("New password");
    fill("short", "short");
    expect(await screen.findByText("Use at least 8 characters.")).toBeTruthy();
    fill("long enough", "long enougX");
    expect(await screen.findByText("The passwords don't match.")).toBeTruthy();
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute("aria-invalid", "true");
    expect(m().state.authCalls.map((c) => c.fn)).toEqual(["initialize"]);
  });

  it("success → signed out and sent to sign-in with the notice", async () => {
    asRecovery();
    const { router } = await openWith("/reset-password?code=abc");
    await screen.findByLabelText("New password");
    fill("brand new pass", "brand new pass");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toEqual({ notice: "password-updated" });
    expect(m().state.authCalls.map((c) => c.fn)).toEqual(["initialize", "updateUser", "signOut"]);
    expect(m().state.session).toBeNull();
  });

  it.each([
    [
      { code: "same_password", message: "New password should be different from the old password." },
      "New password should be different from the old password.",
    ],
    [
      {
        code: "weak_password",
        message: "Password is known to be weak and easy to guess, please choose a different one.",
        reasons: ["pwned"],
      },
      "This password has appeared in a data leak. Choose a different one.",
    ],
    [
      {
        code: "weak_password",
        message: "Password should contain at least one character of each: 0123456789",
        reasons: ["characters"],
      },
      "This password is too weak. Choose a stronger one.",
    ],
  ])("Supabase refusal %j is shown in plain words", async (error, text) => {
    asRecovery();
    m().state.authErrors["updateUser"] = error;
    await openWith("/reset-password?code=abc");
    await screen.findByLabelText("New password");
    fill("some password", "some password");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(text));
    expect(screen.getByRole("button", { name: "Update password" })).not.toBeDisabled();
  });

  it("recovery session ended while typing → the request-a-new-link screen", async () => {
    asRecovery();
    m().state.authErrors["updateUser"] = {
      name: "AuthSessionMissingError",
      message: "Auth session missing!",
    };
    await openWith("/reset-password?code=abc");
    await screen.findByLabelText("New password");
    fill("some password", "some password");
    expect(
      await screen.findByText("Your reset session has ended. Request a new link."),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Request a new link" })).toBeTruthy();
  });
});
