import { Fragment, type ReactNode } from "react";
import { PLACEHOLDER_INFO, type LegalValues } from "@/lib/legal-core";
import { parseInline, placeholderText, type Block, type Inline } from "@/lib/legal-markdown";

/** "staff" shows a visible marker for each missing value; "visitor" never sees one. */
export type LegalViewer = "visitor" | "staff";

function Placeholder({
  node,
  values,
  viewer,
}: {
  node: Extract<Inline, { t: "ph" }>;
  values: LegalValues;
  viewer: LegalViewer;
}) {
  const value = placeholderText(node, values);
  if (value !== null)
    return node.name === "SUPPORT_EMAIL" ? (
      <a href={`mailto:${value}`} dir="ltr">
        {value}
      </a>
    ) : (
      <>{value}</>
    );
  // Visitors' sentences with a missing value are removed before rendering;
  // this is the last guard so "[[" can never reach them.
  if (viewer !== "staff") return null;
  const label = node.name ? PLACEHOLDER_INFO[node.name].label : `unknown placeholder “${node.raw}”`;
  return (
    <mark className="legal-todo" data-testid="legal-todo">
      To be completed: {label}
    </mark>
  );
}

function Inlines({
  nodes,
  values,
  viewer,
}: {
  nodes: Inline[];
  values: LegalValues;
  viewer: LegalViewer;
}): ReactNode {
  return nodes.map((n, k) => {
    switch (n.t) {
      case "text":
        return <Fragment key={k}>{n.v}</Fragment>;
      case "br":
        return <br key={k} />;
      case "code":
        return <code key={k}>{n.v}</code>;
      case "strong":
        return (
          <strong key={k}>
            <Inlines nodes={n.c} values={values} viewer={viewer} />
          </strong>
        );
      case "em":
        return (
          <em key={k}>
            <Inlines nodes={n.c} values={values} viewer={viewer} />
          </em>
        );
      case "link": {
        const external = /^https?:/i.test(n.href);
        return (
          <a key={k} href={n.href} {...(external ? { rel: "noopener noreferrer" } : {})}>
            <Inlines nodes={n.c} values={values} viewer={viewer} />
          </a>
        );
      }
      case "ph":
        return <Placeholder key={k} node={n} values={values} viewer={viewer} />;
    }
  });
}

function Text({
  text,
  values,
  viewer,
}: {
  text: string;
  values: LegalValues;
  viewer: LegalViewer;
}) {
  return <Inlines nodes={parseInline(text)} values={values} viewer={viewer} />;
}

/** One list item: a lone paragraph renders inline (no <p> inside <li>). */
function Item({
  blocks,
  values,
  viewer,
}: {
  blocks: Block[];
  values: LegalValues;
  viewer: LegalViewer;
}) {
  const only = blocks.length === 1 ? blocks[0] : undefined;
  if (only?.t === "p") return <Text text={only.text} values={values} viewer={viewer} />;
  return <Blocks blocks={blocks} values={values} viewer={viewer} />;
}

export function Blocks({
  blocks,
  values,
  viewer,
}: {
  blocks: Block[];
  values: LegalValues;
  viewer: LegalViewer;
}) {
  return blocks.map((b, k) => {
    switch (b.t) {
      case "h": {
        const H = `h${b.level}` as "h2";
        return (
          <H key={k} id={b.id}>
            <Text text={b.text} values={values} viewer={viewer} />
          </H>
        );
      }
      case "p":
        return (
          <p key={k}>
            <Text text={b.text} values={values} viewer={viewer} />
          </p>
        );
      case "hr":
        return <hr key={k} />;
      case "quote":
        return (
          <blockquote key={k}>
            <Blocks blocks={b.blocks} values={values} viewer={viewer} />
          </blockquote>
        );
      case "list": {
        const items = b.items.map((it, j) => (
          <li key={j}>
            <Item blocks={it} values={values} viewer={viewer} />
          </li>
        ));
        return b.ordered ? (
          <ol key={k} start={b.start === 1 ? undefined : b.start}>
            {items}
          </ol>
        ) : (
          <ul key={k}>{items}</ul>
        );
      }
      case "table":
        return (
          <div key={k} className="legal-table">
            <table>
              <thead>
                <tr>
                  {b.head.map((h, j) => (
                    <th key={j} scope="col">
                      <Text text={h} values={values} viewer={viewer} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {r.map((cell, m) => (
                      <td key={m}>
                        <Text text={cell} values={values} viewer={viewer} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}
