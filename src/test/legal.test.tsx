import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { createSupabaseMock } from "./supabase-mock";
import { renderWithRouter } from "./router-harness";
import { englishResources, WithLocale } from "./i18n";
import { createI18n } from "@/i18n/instance";

// Test-only texts (the real ones live in src/content/legal and are checked below).
const FIXTURES = vi.hoisted(() => ({
  "./seller-agreement.md": `---
slug: seller-agreement
title: Seller Agreement
updated: 2026-11-01
---
# Seller Agreement

This agreement is between you and [[COMPANY_NAME]] (business ID [[BUSINESS_ID]]). It explains how selling works.

## Fees and payouts

Saloree keeps a commission of [[COMMISSION_RATE]] of each sale. Card fees are [[WHO_PAYS_STRIPE_FEES]]. Payouts are sent every week.

- Write to [[SUPPORT_EMAIL]] for help.
- Payouts go to your bank account.

## Contact

Our address is [[COMPANY_ADDRESS]].

<script>alert(1)</script>

[Click me](javascript:alert(1)) and read [our privacy policy](privacy.md#data).
`,
  "./terms.md": `---
slug: terms
title: Terms of Use
updated: 2026-10-15
---
These terms apply to everyone who uses Saloree.

## Using Saloree

Be kind.

## Fees

A fee of [[COMMISSION_RATE]]% applies to sellers.
`,
  "./privacy.md": `---
slug: privacy
title: Privacy Policy
updated: 2026-10-20
---
We collect as little as we can.

## Data

Only what we need.
`,
}));
vi.mock("@/content/legal", () => ({ LEGAL_SOURCES: FIXTURES }));

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import { checkLegalSource, splitFrontmatter, type LegalValues } from "@/lib/legal-core";
import {
  describe as describeDoc,
  forVisitors,
  pruneSentences,
  parseInline,
  parseLegalMarkdown,
  placeholderText,
  type Inline,
  safeHref,
  splitSentences,
  tableOfContents,
} from "@/lib/legal-markdown";
import {
  legalDocument,
  legalDocuments,
  legalService,
  loadLegalDocuments,
  publicCommissionSchema,
  toLegalSettings,
  type LegalSettings,
} from "@/services/legal";
import { LegalArticle } from "@/components/legal/legal-article";
import { LegalConsent } from "@/components/legal/legal-links";
import { SiteFooter } from "@/components/marketplace/footer";
import { EMPTY_FOOTER } from "@/services/site";
import { routeTree } from "@/routeTree.gen";

const m = () => mock.current!;
beforeEach(() => m().reset());

const ALL: LegalValues = {
  COMPANY_NAME: "Saloree LLC",
  BUSINESS_ID: "AF-123",
  COMPANY_ADDRESS: "1 Example Street, Kabul",
  SUPPORT_EMAIL: "help@saloree.com",
  COMMISSION_RATE: "12.5",
  WHO_PAYS_STRIPE_FEES: "paid by the seller",
  Stripe: "paid by the seller",
};
const settings = (values: LegalValues, problems: string[] = []): LegalSettings => ({
  values,
  problems,
});

function renderArticle(slug: string, values: LegalValues, viewer: "visitor" | "staff") {
  const doc = legalDocument(slug)!;
  return renderWithRouter(<LegalArticle doc={doc} settings={settings(values)} viewer={viewer} />);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
describe("legal texts: frontmatter and placeholders", () => {
  it("reads slug, title and updated", () => {
    const parts = splitFrontmatter(FIXTURES["./terms.md"])!;
    expect(parts.data).toMatchObject({
      slug: "terms",
      title: "Terms of Use",
      updated: "2026-10-15",
    });
    expect(parts.body.startsWith("These terms")).toBe(true);
    expect(checkLegalSource("terms", FIXTURES["./terms.md"])).toEqual([]);
  });

  it("rejects what could leak a raw [[ or break a page", () => {
    const fm = (body: string, head = "slug: terms\ntitle: T\nupdated: 2026-10-15") =>
      `---\n${head}\n---\n${body}`;
    expect(checkLegalSource("terms", "no frontmatter")[0]).toMatch(/missing frontmatter/);
    expect(checkLegalSource("terms", fm("Hi [[COMPANY]].")).join()).toMatch(/unknown placeholder/);
    expect(checkLegalSource("terms", fm("Hi [[COMPANY_NAME.")).join()).toMatch(/without a closing/);
    expect(checkLegalSource("terms", fm("Hi ]] there.")).join()).toMatch(/without an opening/);
    expect(checkLegalSource("privacy", fm("Hi.")).join()).toMatch(/does not match/);
    expect(
      checkLegalSource("terms", fm("Hi.", "slug: terms\ntitle: T\nupdated: 2026-02-30")).join(),
    ).toMatch(/not a real date/);
    expect(
      checkLegalSource("cookies", fm("Hi.", "slug: cookies\ntitle: T\nupdated: 2026-01-01")).length,
    ).toBeGreaterThan(0);
  });

  it("loads only valid files, in footer order, and skips a bad one with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const docs = loadLegalDocuments({
      ...FIXTURES,
      "./returns.md": "---\nslug: returns\ntitle: Returns\nupdated: 2026-01-01\n---\nUse [[NOPE]].",
    });
    expect(docs.map((d) => d.slug)).toEqual(["terms", "privacy", "seller-agreement"]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/returns\.md is not shown/));
    warn.mockRestore();
  });

  it("the build check passes on the files in src/content/legal and is part of build and test", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["build"]).toMatch(/^node scripts\/legal-check\.ts && vite build$/);
    expect(pkg.scripts["test"]).toContain("node scripts/legal-check.ts");
  });
});

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------
describe("safe markdown", () => {
  it("never interprets HTML or unsafe links", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("https://stripe.com/privacy")).toBe("https://stripe.com/privacy");
    expect(safeHref("mailto:help@saloree.com")).toBe("mailto:help@saloree.com");
    expect(safeHref("privacy.md#data")).toBe("/legal/privacy#data");
    expect(safeHref("./cookies.md")).toBeNull();
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ t: "text", v: "x" }]);
  });

  it("parses headings, lists, quotes, rules, tables and inline styles", () => {
    const blocks = parseLegalMarkdown(
      [
        "# Title",
        "",
        "Intro with **bold**, *italic*, `code` and snake_case_name.",
        "",
        "## Your rights",
        "",
        "1. First",
        "   continued",
        "2. Second",
        "   - nested",
        "",
        "> Note",
        "",
        "---",
        "",
        "| Item | Days |",
        "| --- | --- |",
        "| Return | 14 |",
        "",
        "## Your rights",
      ].join("\n"),
      "Title",
    );
    expect(blocks.map((b) => b.t)).toEqual(["p", "h", "list", "quote", "hr", "table", "h"]);
    const list = blocks[2] as Extract<(typeof blocks)[number], { t: "list" }>;
    expect(list.ordered).toBe(true);
    expect(list.items[0]).toEqual([{ t: "p", text: "First continued" }]);
    expect(list.items[1]![1]!.t).toBe("list");
    // Duplicate headings get distinct ids.
    expect(tableOfContents(blocks, {})).toEqual([
      { id: "your-rights", text: "Your rights" },
      { id: "your-rights-2", text: "Your rights" },
    ]);
    expect(parseInline("a **b** *c* `d` snake_case_name")).toEqual([
      { t: "text", v: "a " },
      { t: "strong", c: [{ t: "text", v: "b" }] },
      { t: "text", v: " " },
      { t: "em", c: [{ t: "text", v: "c" }] },
      { t: "text", v: " " },
      { t: "code", v: "d" },
      { t: "text", v: " snake_case_name" },
    ]);
  });

  it("splits sentences, but not after common abbreviations", () => {
    expect(splitSentences("One. Two, e.g. this. Three!")).toEqual([
      "One. ",
      "Two, e.g. this. ",
      "Three!",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------
describe("placeholder values", () => {
  it("come from company details and public_commission_percent() (never the table)", async () => {
    // Replies in order: site_settings, then the RPC.
    m().state.queue.push(
      {
        data: {
          footer_settings: {
            legal_name: " Saloree LLC ",
            business_id: "AF-123",
            address: "",
            support_email: "not-an-email",
            stripe_fees_text: "paid by the seller",
            theme: "dark",
          },
        },
      },
      { data: "10.00" },
    );
    const s = await legalService.settings();
    expect(s.values).toEqual({
      COMPANY_NAME: "Saloree LLC",
      BUSINESS_ID: "AF-123",
      COMMISSION_RATE: "10",
      WHO_PAYS_STRIPE_FEES: "paid by the seller",
      Stripe: "Stripe", // the processor's name, not the "who pays" wording
    });
    expect(s.problems).toEqual([]);
    expect(m().state.rpcs).toEqual([{ fn: "public_commission_percent", args: undefined }]);
    expect(m().state.queries.map((q) => q.table)).toEqual(["site_settings"]);
  });

  it("the rate is validated: a number or null", () => {
    expect(publicCommissionSchema.parse(12.5)).toBe(12.5);
    expect(publicCommissionSchema.parse("7.25")).toBe(7.25);
    expect(publicCommissionSchema.parse(null)).toBeNull();
    for (const bad of [-1, 101, "abc", {}, Number.NaN])
      expect(publicCommissionSchema.safeParse(bad).success, String(bad)).toBe(false);
    expect(toLegalSettings({}, 12.345).values.COMMISSION_RATE).toBe("12.35");
    const odd = toLegalSettings({}, "abc");
    expect(odd.values.COMMISSION_RATE).toBeUndefined();
    expect(odd.problems).toEqual([
      "public_commission_percent returned something that is not a percentage.",
    ]);
  });

  it("a value that can't be read is missing, with the database's reason (never thrown)", async () => {
    m().state.queue.push(
      { data: null },
      {
        error: {
          code: "PGRST202",
          message:
            "Could not find the function public.public_commission_percent without parameters",
        },
      },
    );
    const s = await legalService.settings();
    expect(s.values).toEqual({ Stripe: "Stripe" });
    expect(s.problems).toEqual([
      "public_commission_percent: Could not find the function public.public_commission_percent without parameters (PGRST202)",
    ]);
    m().state.queue.push({ data: null }, { data: null });
    expect((await legalService.settings()).problems).toEqual([
      "public_commission_percent returned no rate, so the commission is hidden.",
    ]);
  });
});

describe("missing values: only the value goes where the sentence still reads well", () => {
  const v: LegalValues = { COMPANY_NAME: "Saloree LLC", BUSINESS_ID: "AF-1", Stripe: "Stripe" };

  it("an item in a comma list of details, keeping what follows", () => {
    expect(
      pruneSentences(
        'Run by **[[COMPANY_NAME]]**, business ID **[[BUSINESS_ID]]**, address **[[COMPANY_ADDRESS]]**, e-mail **[[SUPPORT_EMAIL]]** ("Saloree", "we"). Next.',
        v,
      ),
    ).toBe('Run by **[[COMPANY_NAME]]**, business ID **[[BUSINESS_ID]]** ("Saloree", "we"). Next.');
    expect(pruneSentences("Controller: **[[COMPANY_NAME]]**, **[[SUPPORT_EMAIL]]**.", v)).toBe(
      "Controller: **[[COMPANY_NAME]]**.",
    );
  });

  it('a value saved with a final "." never doubles the text\'s punctuation', () => {
    const ph = (src: string) => {
      const strong = parseInline(src)[0] as Extract<Inline, { t: "strong" }>;
      return strong.c[0] as Extract<Inline, { t: "ph" }>;
    };
    const address = { COMPANY_ADDRESS: "01280 Vantaa, Finland." };
    expect(placeholderText(ph("**[[COMPANY_ADDRESS]]**, e-mail"), address)).toBe(
      "01280 Vantaa, Finland",
    );
    expect(placeholderText(ph("**[[COMPANY_ADDRESS]]**."), address)).toBe("01280 Vantaa, Finland");
    expect(placeholderText(ph("**[[COMPANY_ADDRESS]]** · x"), address)).toBe(
      "01280 Vantaa, Finland.",
    );
    const ltd = { COMPANY_NAME: "Example Ltd." };
    expect(placeholderText(ph("**[[COMPANY_NAME]]**, a company"), ltd)).toBe("Example Ltd.");
    expect(placeholderText(ph("**[[COMPANY_NAME]]**."), ltd)).toBe("Example Ltd");
  });

  it('a "·" contact line keeps the details it has', () => {
    expect(pruneSentences("[[COMPANY_NAME]] · [[BUSINESS_ID]] · [[SUPPORT_EMAIL]]", v)).toBe(
      "[[COMPANY_NAME]] · [[BUSINESS_ID]]",
    );
    expect(pruneSentences("[[SUPPORT_EMAIL]] · [[COMPANY_ADDRESS]]", v)).toBe("");
  });

  it('one "or" alternative', () => {
    expect(
      pruneSentences("Write to the seller or to **[[SUPPORT_EMAIL]]** with your order number.", v),
    ).toBe("Write to the seller with your order number.");
    expect(
      pruneSentences("Tell us through the order page or **[[SUPPORT_EMAIL]]**, with photos.", v),
    ).toBe("Tell us through the order page, with photos.");
  });

  it("otherwise the whole sentence, never a broken one", () => {
    expect(
      pruneSentences(
        "Names belong to their owners. If you object, write to **[[SUPPORT_EMAIL]]** with the link. We review notices.",
        v,
      ),
    ).toBe("Names belong to their owners. We review notices.");
    expect(pruneSentences("Please contact us at **[[SUPPORT_EMAIL]]**; we answer fast.", v)).toBe(
      "",
    );
  });

  it("a section left empty loses its heading; a paragraph after a list stays a paragraph", () => {
    const blocks = parseLegalMarkdown(
      [
        "## Contact",
        "Write to **[[SUPPORT_EMAIL]]**.",
        "## Data",
        "- Sellers get your address.",
        "- Carriers too.",
        "We do not sell your personal data.",
        "- A wrapped item that goes",
        "on here.",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.t)).toEqual(["h", "p", "h", "list", "p", "list"]);
    const last = blocks[5] as Extract<(typeof blocks)[number], { t: "list" }>;
    expect(last.items[0]).toEqual([{ t: "p", text: "A wrapped item that goes on here." }]);
    expect(forVisitors(blocks, v).map((b) => (b.t === "h" ? b.text : b.t))).toEqual([
      "Data",
      "list",
      "p",
      "list",
    ]);
  });
});

describe("visitors never see a missing value", () => {
  const doc = () => legalDocument("seller-agreement")!;

  it("drops only the sentences that need it; an emptied list item disappears", () => {
    const blocks = forVisitors(doc().blocks, { COMPANY_NAME: "Saloree LLC" });
    const strings: string[] = [];
    JSON.stringify(blocks, (k, v: unknown) => {
      if (k === "text" && typeof v === "string") strings.push(v);
      return v;
    });
    const text = strings.join("\n");
    expect(text).not.toContain("[[");
    expect(text).toContain("It explains how selling works.");
    expect(text).toContain("Payouts are sent every week.");
    expect(text).not.toContain("commission");
    expect(text).not.toContain("Write to");
    expect(text).toContain("Payouts go to your bank account.");
    // The "Contact" paragraph had only the address: it is gone, the heading stays.
    expect(text).not.toContain("Our address");
  });

  it("the meta description is made from what visitors see", () => {
    expect(describeDoc(forVisitors(doc().blocks, {}), {})).toBe("It explains how selling works.");
    expect(describeDoc(forVisitors(doc().blocks, ALL), ALL)).toBe(
      "This agreement is between you and Saloree LLC (business ID AF-123). It explains how selling works.",
    );
  });
});

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
describe("legal page", () => {
  it("renders title, date, contents and the text with every value filled", async () => {
    const { container } = renderArticle("seller-agreement", ALL, "visitor");
    expect(await screen.findByRole("heading", { level: 1, name: "Seller Agreement" })).toBeTruthy();
    expect(screen.getByText("Last updated November 1, 2026")).toBeTruthy();
    const body = screen.getByTestId("legal-body");
    expect(body.textContent).toContain("between you and Saloree LLC (business ID AF-123)");
    expect(body.textContent).toContain("a commission of 12.5% of each sale");
    expect(body.textContent).toContain("Card fees are paid by the seller.");
    expect(within(body).getByRole("link", { name: "help@saloree.com" }).getAttribute("href")).toBe(
      "mailto:help@saloree.com",
    );
    expect(container.innerHTML).not.toContain("[[");
    // No HTML is interpreted; the unsafe link keeps only its text.
    expect(container.querySelector("script")).toBeNull();
    expect(body.textContent).toContain("<script>alert(1)</script>");
    expect(within(body).queryByRole("link", { name: "Click me" })).toBeNull();
    expect(
      within(body).getByRole("link", { name: "our privacy policy" }).getAttribute("href"),
    ).toBe("/legal/privacy#data");
    // The repeated "# Seller Agreement" is not shown twice.
    expect(screen.getAllByText("Seller Agreement")).toHaveLength(2); // h1 + breadcrumb
  });

  it("a contents link points at a heading that exists", async () => {
    const { container } = renderArticle("seller-agreement", ALL, "visitor");
    const toc = await screen.findByRole("navigation", { name: "On this page" });
    const links = within(toc).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Fees and payouts", "Contact"]);
    for (const a of links) {
      const id = a.getAttribute("href")!.replace(/^#/, "");
      const target = container.querySelector(`[id="${id}"]`);
      expect(target?.tagName, id).toBe("H2");
      expect(target?.textContent).toBe(a.textContent);
    }
  });

  it('"[[COMMISSION_RATE]]%" reads 12.5%, not 12.5%%', async () => {
    renderArticle("terms", ALL, "visitor");
    expect((await screen.findByTestId("legal-body")).textContent).toContain(
      "A fee of 12.5% applies",
    );
  });

  it("visitors: no raw [[, no marker, no staff note when values are missing", async () => {
    const { container } = renderArticle("seller-agreement", {}, "visitor");
    await screen.findByTestId("legal-body");
    expect(container.innerHTML).not.toContain("[[");
    expect(screen.queryByTestId("legal-todo")).toBeNull();
    expect(screen.queryByTestId("legal-staff-note")).toBeNull();
    expect(screen.getByTestId("legal-body").textContent).not.toMatch(/commission|Write to/);
  });

  it("staff: a visible 'to be completed' marker for each missing value, and where to set it", async () => {
    const { container } = renderArticle(
      "seller-agreement",
      { COMPANY_NAME: "Saloree LLC" },
      "staff",
    );
    const marks = await screen.findAllByTestId("legal-todo");
    expect(marks.map((x) => x.textContent)).toEqual([
      "To be completed: Business ID",
      "To be completed: Commission rate",
      "To be completed: Who pays the card (Stripe) fees",
      "To be completed: Support email",
      "To be completed: Company address",
    ]);
    expect(container.innerHTML).not.toContain("[[");
    const note = screen.getByTestId("legal-staff-note");
    expect(note.textContent).toContain("Commission rate: set it in Admin → Platform commission.");
    expect(note.textContent).toContain(
      "Who pays the card (Stripe) fees: set it in Admin → Finance → Company details → Card fees wording.",
    );
  });

  it("other languages: the page says the text is in English for now", async () => {
    const doc = legalDocument("privacy")!;
    try {
      renderWithRouter(
        <WithLocale locale="de">
          <LegalArticle doc={doc} settings={settings(ALL)} viewer="visitor" />
        </WithLocale>,
      );
      expect(
        await screen.findByText("Diese Seite ist vorerst nur auf Englisch verfügbar."),
      ).toBeTruthy();
      expect(screen.getByTestId("legal-body").getAttribute("lang")).toBe("en");
      expect(screen.getByTestId("legal-body").getAttribute("dir")).toBe("ltr");
    } finally {
      createI18n("en", englishResources); // the other tests read English
    }
  });
});

// ---------------------------------------------------------------------------
// The real texts in src/content/legal
// ---------------------------------------------------------------------------
describe("the files in src/content/legal", async () => {
  const actual = await vi.importActual<typeof import("@/content/legal")>("@/content/legal");
  const real = loadLegalDocuments(actual.LEGAL_SOURCES);

  it("every file there is valid (a bad one would be hidden)", () => {
    expect(real.length).toBe(Object.keys(actual.LEGAL_SOURCES).length);
  });

  for (const doc of real) {
    it(`${doc.slug}: no raw [[ with every value, and none for visitors without values`, () => {
      for (const [values, viewer] of [
        [ALL, "visitor"],
        [ALL, "staff"],
        [{}, "visitor"],
        [{ ...ALL, SUPPORT_EMAIL: "" }, "visitor"],
      ] as const) {
        const { container, unmount } = renderWithRouter(
          <LegalArticle doc={doc} settings={settings(values)} viewer={viewer} />,
        );
        expect(container.innerHTML, `${doc.slug} ${viewer}`).not.toContain("[[");
        unmount();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Links to the pages
// ---------------------------------------------------------------------------
async function renderFooter() {
  const root = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <SiteFooter categories={[]} content={EMPTY_FOOTER} />
      </>
    ),
  });
  const page = (path: string) => createRoute({ getParentRoute: () => root, path });
  const router = createRouter({
    routeTree: root.addChildren(["/", "/help", "/legal/$slug"].map(page)),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return screen.findByRole("contentinfo");
}

describe("links to the legal pages", () => {
  it("footer: Customer Service plus one link per page in this build, each a real page (no 404)", async () => {
    const footer = await renderFooter();
    const col = within(footer)
      .getByRole("heading", { name: "Help and policies" })
      .closest("section")!;
    const links = within(col).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Customer Service", "/help"],
      ["Terms of Use", "/legal/terms"],
      ["Privacy Policy", "/legal/privacy"],
      ["Seller Agreement", "/legal/seller-agreement"],
    ]);
    // No link for Returns or Shipping: those files aren't in this build.
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    for (const a of links.slice(1)) {
      const href = a.getAttribute("href")!;
      expect(router.matchRoutes(href).at(-1)?.routeId, href).toBe("/legal/$slug");
      expect(legalDocument(href.replace("/legal/", "")), href).toBeTruthy(); // its loader won't 404
    }
    expect(router.matchRoutes("/legal").at(-1)?.routeId).toBe("/legal/");
  });

  it("checkout and signup: 'By continuing you agree to…' links Terms and Privacy", async () => {
    renderWithRouter(<LegalConsent />);
    const p = await screen.findByTestId("legal-consent");
    expect(p.textContent).toBe(
      "By continuing you agree to the Terms of Use and the Privacy Policy.",
    );
    expect(
      within(p)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual(["/legal/terms", "/legal/privacy"]);
  });

  it("the consent line is in the signup form and at checkout", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    expect(read("src/routes/register.tsx")).toContain("consent={<LegalConsent />}");
    expect(read("src/routes/checkout.tsx")).toContain("<LegalConsent");
  });

  it("documents are bundled in footer order", () => {
    expect(legalDocuments().map((d) => d.slug)).toEqual(["terms", "privacy", "seller-agreement"]);
  });
});

// ---------------------------------------------------------------------------
// Seller Agreement on the create-store form
// ---------------------------------------------------------------------------
describe("create store: the Seller Agreement checkbox", async () => {
  const { StoreForm } = await import("@/components/seller/store-form");
  const { sellerService } = await import("@/services/seller");

  it("is required, names the version, and blocks the submit until ticked", async () => {
    const onSubmit = vi.fn(async () => {});
    render(
      <StoreForm
        categoryNames={[]}
        submitLabel="Create store"
        busy={false}
        onSubmit={onSubmit}
        agreement={{ updated: "2026-11-01" }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Store name"), { target: { value: "Beta Decor" } });
    const box = screen.getByRole("checkbox", {
      name: /Seller Agreement \(version of 2026-11-01\)/,
    });
    expect(box).toBeRequired();
    expect(screen.getByRole("link", { name: "Seller Agreement" }).getAttribute("href")).toBe(
      "/legal/seller-agreement",
    );
    fireEvent.click(screen.getByRole("button", { name: "Create store" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Accept the Seller Agreement to create your store.",
    );
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Create store" }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("no checkbox when editing a store", () => {
    render(
      <StoreForm categoryNames={[]} submitLabel="Save" busy={false} onSubmit={async () => {}} />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("sends only the accepted version (the database sets the time); the real error when the column is missing", async () => {
    m().state.queue.push({ data: [{ id: "s1" }] });
    await sellerService.recordSellerAgreement("s1", "2026-11-01");
    const update = m()
      .callsOn("stores", 0)
      .find((c) => c[0] === "update")!;
    expect(update[1]).toEqual({ seller_agreement_version: "2026-11-01" });
    expect(JSON.stringify(m().callsOn("stores", 0))).not.toContain("accepted_at");
    m().state.queue.push({
      error: {
        code: "PGRST204",
        message: "Could not find the 'seller_agreement_version' column of 'stores'",
      },
    });
    await expect(sellerService.recordSellerAgreement("s1", "2026-11-01")).rejects.toMatchObject({
      code: "PGRST204",
    });
  });
});
