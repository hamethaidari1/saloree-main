import { beforeEach, describe, expect, it, vi } from "vitest";
import { isRedirect } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";

// Controls what the mocked Supabase client returns for the session and roles.
const state = vi.hoisted(() => ({
  session: null as { user: { id: string; email: string } } | null,
  roles: [] as string[],
  rolesError: null as { code: string; message: string } | null,
  queriedUserId: null as string | null,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      getUser: async () => ({ data: { user: state.session?.user ?? null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: async (_col: string, userId: string) => {
          if (table !== "user_roles") throw new Error(`unexpected table ${table}`);
          state.queriedUserId = userId;
          return state.rolesError
            ? { data: null, error: state.rolesError }
            : { data: state.roles.map((role) => ({ role })), error: null };
        },
      }),
    }),
  },
}));

import { decideAccess, requireAuth, requireRoleOrForbid } from "@/lib/auth";

const signIn = (roles: string[], id = "user-1") => {
  state.session = { user: { id, email: `${id}@example.com` } };
  state.roles = roles;
};
const at = (href: string) => ({ location: { href } });

/** Runs a guard and returns the thrown redirect's options (or fails). */
async function redirectOf(run: Promise<unknown>) {
  try {
    await run;
  } catch (e) {
    expect(isRedirect(e)).toBe(true);
    return (e as { options: { to: string; search?: Record<string, unknown> } }).options;
  }
  throw new Error("Expected the guard to redirect");
}

beforeEach(() => {
  state.session = null;
  state.roles = [];
  state.rolesError = null;
  state.queriedUserId = null;
});

describe("decideAccess", () => {
  const user = { id: "u" } as User;
  it("sends signed-out visitors to login", () => {
    expect(decideAccess(null, [], "admin")).toBe("login");
    expect(decideAccess(null, ["admin"], "admin")).toBe("login");
  });
  it("forbids signed-in users without the exact role", () => {
    expect(decideAccess(user, [], "admin")).toBe("forbidden");
    expect(decideAccess(user, ["customer"], "admin")).toBe("forbidden");
    expect(decideAccess(user, ["seller"], "admin")).toBe("forbidden");
    expect(decideAccess(user, ["Admin", "administrator"], "admin")).toBe("forbidden");
  });
  it("allows the role, and any signed-in user when no role is required", () => {
    expect(decideAccess(user, ["customer", "admin"], "admin")).toBe("allowed");
    expect(decideAccess(user, [])).toBe("allowed");
  });
});

describe("admin guard (requireRoleOrForbid)", () => {
  const guard = requireRoleOrForbid("admin");

  it("redirects signed-out visitors to /login and remembers where they were going", async () => {
    const options = await redirectOf(guard(at("/admin?tab=users")));
    expect(options.to).toBe("/login");
    expect(options.search).toEqual({ redirect: "/admin?tab=users" });
  });

  it.each([[[]], [["customer"]], [["seller"]], [["customer", "seller"]]])(
    "shows 'not allowed' to a signed-in user with roles %j",
    async (roles) => {
      signIn(roles);
      await expect(guard(at("/admin"))).resolves.toMatchObject({ allowed: false });
    },
  );

  it("lets admins in", async () => {
    signIn(["admin"]);
    await expect(guard(at("/admin"))).resolves.toMatchObject({
      allowed: true,
      roles: ["admin"],
      user: { id: "user-1" },
    });
  });

  it("checks the roles of the signed-in user, from user_roles", async () => {
    signIn(["admin"], "user-42");
    await guard(at("/admin"));
    expect(state.queriedUserId).toBe("user-42");
  });

  it("fails closed when roles cannot be read", async () => {
    signIn(["admin"]);
    state.rolesError = { code: "42501", message: "permission denied for table user_roles" };
    await expect(guard(at("/admin"))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("seller guard (requireAuth)", () => {
  it("redirects non-sellers to /account", async () => {
    signIn(["customer"]);
    expect((await redirectOf(requireAuth("seller")(at("/seller")))).to).toBe("/account");
  });
  it("admins are not implicitly sellers", async () => {
    signIn(["admin"]);
    expect((await redirectOf(requireAuth("seller")(at("/seller")))).to).toBe("/account");
  });
  it("lets sellers in", async () => {
    signIn(["seller"]);
    await expect(requireAuth("seller")(at("/seller"))).resolves.toMatchObject({
      roles: ["seller"],
    });
  });
});

describe("/admin route", () => {
  // The first import of the admin route compiles every staff panel (~4 s on its
  // own); under a full parallel run that alone can pass the default 5 s.
  it("is client-only and guarded by the admin role check", { timeout: 20_000 }, async () => {
    const { Route } = await import("@/routes/admin");
    expect(Route.options.ssr).toBe(false);
    signIn(["seller"]);
    const beforeLoad = Route.options.beforeLoad as unknown as (
      ctx: ReturnType<typeof at>,
    ) => Promise<{ allowed: boolean }>;
    await expect(beforeLoad(at("/admin"))).resolves.toMatchObject({ allowed: false });
    signIn(["admin"]);
    await expect(beforeLoad(at("/admin"))).resolves.toMatchObject({ allowed: true });
  });
});
