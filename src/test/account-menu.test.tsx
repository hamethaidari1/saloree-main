import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

const auth = vi.hoisted(() => ({
  state: {
    user: null as null | { id: string; email: string; user_metadata: Record<string, unknown> },
    roles: [] as string[],
    ready: true,
  },
  signOut: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    ...auth.state,
    isSeller: auth.state.roles.includes("seller"),
    isAdmin: auth.state.roles.includes("admin"),
  }),
  signOut: auth.signOut,
}));

import {
  AccountMenu,
  AccountMenuPanel,
  firstName,
  MobileAccountLink,
} from "@/components/marketplace/header/account-menu";
import { renderWithRouter } from "./router-harness";

const sara = { id: "u1", email: "sara@example.com", user_metadata: { full_name: "Sara Ahmadi" } };
function as(roles: string[] | null) {
  auth.state =
    roles === null ? { user: null, roles: [], ready: true } : { user: sara, roles, ready: true };
}

/** Opens the header dropdown and returns the panel. */
async function openMenu() {
  const trigger = await screen.findByRole("button", { name: /account & lists/i });
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  return screen.findByRole("dialog");
}
const linkNames = (panel: HTMLElement) =>
  within(panel)
    .queryAllByRole("link")
    .map((a) => a.textContent?.trim());

beforeEach(() => {
  as(null);
  auth.signOut.mockClear();
});

describe("account dropdown", () => {
  it("signed out: greets with 'Hello, sign in' and offers Sign in / Start here", async () => {
    renderWithRouter(<AccountMenu />);
    expect(await screen.findByText("Hello, sign in")).toBeInTheDocument();
    const panel = await openMenu();
    expect(within(panel).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(within(panel).getByText(/New customer\?/)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Start here" })).toHaveAttribute(
      "href",
      "/register",
    );
    expect(within(panel).queryByRole("button", { name: /sign out/i })).toBeNull();
    expect(within(panel).queryByText("My orders")).toBeNull();
  });

  it("customer: greets by first name and shows orders, wishlist, account, sign out", async () => {
    as(["customer"]);
    renderWithRouter(<AccountMenu />);
    expect(await screen.findByText("Hello, Sara")).toBeInTheDocument();
    const panel = await openMenu();
    expect(linkNames(panel)).toEqual(["My orders", "Account"]);
    expect(within(panel).getByRole("link", { name: "My orders" })).toHaveAttribute(
      "href",
      "/account#my-orders",
    );
    const wishlist = within(panel).getByText("Wishlist").closest("[aria-disabled]");
    expect(wishlist).toHaveAttribute("aria-disabled", "true");
    expect(wishlist).toHaveTextContent("Coming soon");
    expect(within(panel).getByRole("button", { name: /sign out/i })).toBeInTheDocument();
    expect(within(panel).queryByRole("link", { name: "My store" })).toBeNull();
    expect(within(panel).queryByRole("link", { name: "Admin" })).toBeNull();
  });

  it("seller: adds My store, not Admin", async () => {
    as(["customer", "seller"]);
    renderWithRouter(<AccountMenu />);
    const panel = await openMenu();
    expect(linkNames(panel)).toEqual(["My orders", "Account", "My store"]);
    expect(within(panel).getByRole("link", { name: "My store" })).toHaveAttribute(
      "href",
      "/seller",
    );
  });

  it("admin: adds Admin, not My store", async () => {
    as(["admin"]);
    renderWithRouter(<AccountMenu />);
    const panel = await openMenu();
    expect(linkNames(panel)).toEqual(["My orders", "Account", "Admin"]);
    expect(within(panel).getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
  });

  it("admin who is also a seller sees both", async () => {
    as(["seller", "admin"]);
    renderWithRouter(<AccountMenu />);
    const panel = await openMenu();
    expect(linkNames(panel)).toEqual(["My orders", "Account", "My store", "Admin"]);
  });

  it("Sign out calls signOut and closes the menu", async () => {
    as(["customer"]);
    renderWithRouter(<AccountMenu />);
    const panel = await openMenu();
    fireEvent.click(within(panel).getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("clicking the trigger again closes it (keyboard users can toggle)", async () => {
    renderWithRouter(<AccountMenu />);
    await openMenu();
    fireEvent.click(screen.getByRole("button", { name: /account & lists/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("while auth is loading, shows neither sign-in prompt nor account links", async () => {
    auth.state = { user: null, roles: [], ready: false };
    renderWithRouter(<AccountMenuPanel />);
    expect(await screen.findByLabelText("Loading your account")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });
});

describe("mobile account link", () => {
  it("signed out: 'Sign in ›' goes to /login", async () => {
    renderWithRouter(<MobileAccountLink />);
    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link).toHaveAttribute("href", "/login");
    expect(link).toHaveTextContent("Sign in");
  });
  it("signed in: shows the first name and goes to the account page", async () => {
    as(["customer"]);
    renderWithRouter(<MobileAccountLink />);
    const link = await screen.findByRole("link", { name: "Your account, Sara" });
    expect(link).toHaveAttribute("href", "/account");
    expect(link).toHaveTextContent("Sara");
  });
  it("while loading shows only the icon, no 'Sign in' flash", async () => {
    auth.state = { user: null, roles: [], ready: false };
    renderWithRouter(<MobileAccountLink />);
    const link = await screen.findByRole("link", { name: "Account" });
    expect(link).not.toHaveTextContent("Sign in");
  });
});

describe("firstName", () => {
  it("uses the first word of the full name, else the email", () => {
    expect(firstName(sara as never)).toBe("Sara");
    expect(firstName({ email: "amir@example.com", user_metadata: {} } as never)).toBe("amir");
    expect(firstName(null)).toBe("");
  });
});
