"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

/* ------------------------------------------------------------------ */
/*  Address + hash auto-linkify                                        */
/* ------------------------------------------------------------------ */

const ADDRESS_RE = /\br[1-9A-HJ-NP-Za-km-z]{24,34}\b/g;
const HASH_RE = /\b[A-F0-9]{64}\b/g;
// Combined matcher with alternation. Uses a single named pattern so we
// can iterate and decide route based on the leading character.
const ADDR_OR_HASH = /\b(r[1-9A-HJ-NP-Za-km-z]{24,34}|[A-F0-9]{64})\b/g;

function truncateAddress(s: string): string {
  return s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s;
}
function truncateHash(s: string): string {
  return s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s;
}

/** Split a text string into a mix of literal text + anchor JSX for any
 *  XRPL addresses or 64-char tx hashes found inside. Non-matching
 *  strings come back unchanged. */
function splitAndLinkText(text: string): React.ReactNode {
  if (!ADDRESS_RE.test(text) && !HASH_RE.test(text)) return text;

  const out: React.ReactNode[] = [];
  let last = 0;
  ADDR_OR_HASH.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ADDR_OR_HASH.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const matched = m[1];
    const isAddress = matched.startsWith("r");
    const href = isAddress ? `/account/${matched}` : `/tx/${matched}`;
    const display = isAddress ? truncateAddress(matched) : truncateHash(matched);
    out.push(
      <a
        key={`${matched}-${m.index}`}
        href={href}
        className="text-brand transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
      >
        {display}
      </a>,
    );
    last = ADDR_OR_HASH.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Walk children recursively, applying splitAndLinkText to string leaves
 *  and skipping elements where linking is wrong (existing anchors, code). */
function linkify(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string") return splitAndLinkText(child);
    if (typeof child === "number" || child == null || typeof child === "boolean") return child;
    if (!React.isValidElement(child)) return child;

    const childType = child.type;
    // Don't linkify inside existing anchors or code/pre — would produce
    // invalid nested anchors or mangle SQL/code samples.
    if (childType === "a" || childType === "code" || childType === "pre") return child;

    const props = child.props as { children?: React.ReactNode };
    if (props.children == null) return child;
    return React.cloneElement(
      child,
      {} as React.Attributes,
      linkify(props.children),
    );
  });
}

/**
 * Renders Markdown answer text from the AI with the Sonde design system
 * mapped onto each element. Handles GFM tables, fenced code blocks,
 * inline code, lists, blockquotes, links, etc.
 *
 * Used inside the assistant message bubble on /asktheledger. The
 * structured chart/stat/table renderers handle whatever shape they
 * detect from rawResults; this is the pure-prose path.
 *
 * During streaming, partial markdown (e.g. `# Top`) renders as-best-can —
 * react-markdown is tolerant of incomplete input.
 *
 * Mobile note: markdown tables get a card-stack rendering on screens
 * narrower than `md` (768px) so the chat bubble doesn't horizontally
 * scroll. Achieved by walking the table's children to extract headers
 * + row cells, then rendering as a list of bordered cards.
 */

/* ------------------------------------------------------------------ */
/*  Markdown table → card-stack data extraction                        */
/* ------------------------------------------------------------------ */

interface TableData {
  headers: React.ReactNode[];
  rows: React.ReactNode[][];
}

/**
 * Walk the children of a markdown <table> and return its headers + rows
 * as React nodes (preserving inline formatting like links, bold, etc.).
 *
 * Match by string ("td") OR by displayName on customized table-element
 * components (so we can keep customizing td/th to apply linkify and
 * still extract data for the mobile card-stack rendering).
 */
function extractTableData(children: React.ReactNode): TableData | null {
  const headers: React.ReactNode[] = [];
  const rows: React.ReactNode[][] = [];

  const matchType = (type: unknown, tag: string): boolean => {
    if (type === tag) return true;
    if (typeof type === "function") {
      const named = type as { displayName?: string };
      return named.displayName === tag;
    }
    return false;
  };

  const visit = (node: React.ReactNode): void => {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      const childType = child.type;
      const props = child.props as { children?: React.ReactNode };

      if (matchType(childType, "thead")) {
        // First <tr>'s <th> children are the headers.
        React.Children.forEach(props.children, (tr) => {
          if (!React.isValidElement(tr) || !matchType(tr.type, "tr")) return;
          const trProps = tr.props as { children?: React.ReactNode };
          React.Children.forEach(trProps.children, (th) => {
            if (React.isValidElement(th) && matchType(th.type, "th")) {
              const thProps = th.props as { children?: React.ReactNode };
              headers.push(thProps.children);
            }
          });
        });
      } else if (matchType(childType, "tbody")) {
        React.Children.forEach(props.children, (tr) => {
          if (!React.isValidElement(tr) || !matchType(tr.type, "tr")) return;
          const trProps = tr.props as { children?: React.ReactNode };
          const cells: React.ReactNode[] = [];
          React.Children.forEach(trProps.children, (td) => {
            if (React.isValidElement(td) && matchType(td.type, "td")) {
              const tdProps = td.props as { children?: React.ReactNode };
              cells.push(tdProps.children);
            }
          });
          rows.push(cells);
        });
      } else {
        // Walk deeper for any unexpected wrapper.
        visit(props.children);
      }
    });
  };

  visit(children);

  if (headers.length === 0 || rows.length === 0) return null;
  return { headers, rows };
}

/* ------------------------------------------------------------------ */
/*  Components map                                                     */
/* ------------------------------------------------------------------ */

const components: Components = {
  /* ── Headings ──────────────────────────────────────────────────── */
  h1: ({ children }) => (
    <h2 className="mt-4 mb-2 font-display text-h2 font-semibold text-primary first:mt-0">
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h3 className="mt-4 mb-2 font-display text-h3 font-semibold text-primary first:mt-0">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-3 mb-1.5 font-display text-body font-semibold text-primary first:mt-0">
      {children}
    </h4>
  ),
  h4: ({ children }) => (
    <h5 className="mt-3 mb-1 font-display text-tag uppercase tracking-header text-muted first:mt-0">
      {children}
    </h5>
  ),

  /* ── Paragraph + inline ────────────────────────────────────────── */
  // Linkify is applied at the leaf-text-rendering components (p, li,
  // strong, em) so any address/hash mentioned in prose becomes a link
  // to /account/[address] or /tx/[hash], displayed truncated.
  p: ({ children }) => (
    <p className="font-body text-ui leading-relaxed text-primary [&:not(:first-child)]:mt-3">
      {linkify(children)}
    </p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-primary">{linkify(children)}</strong>
  ),
  em: ({ children }) => <em className="italic">{linkify(children)}</em>,
  a: ({ href, children }) => {
    const external = !!href && /^https?:\/\//i.test(href);
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        className="text-brand transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
      >
        {children}
      </a>
    );
  },

  /* ── Code ──────────────────────────────────────────────────────── */
  code: ({ children, className }) => {
    if (!className) {
      return (
        <code className="rounded-sm bg-elevated px-1 py-0.5 font-mono text-tag text-primary">
          {children}
        </code>
      );
    }
    return <code className={className}>{children}</code>;
  },
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-lg border border-elevated bg-bg/50 p-3 font-mono text-cell text-primary">
      {children}
    </pre>
  ),

  /* ── Lists ─────────────────────────────────────────────────────── */
  ul: ({ children }) => (
    <ul className="my-3 list-disc space-y-1 pl-6 marker:text-muted">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-decimal space-y-1 pl-6 marker:text-muted">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="font-body text-ui leading-relaxed text-primary">{linkify(children)}</li>
  ),

  /* ── Blockquote + hr ───────────────────────────────────────────── */
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-brand/40 pl-4 italic text-secondary">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-t border-elevated" />,

  /* ── GFM tables ────────────────────────────────────────────────── */
  // Custom <td> applies linkify to cell text so addresses + tx hashes
  // mentioned inside markdown tables become clickable links to
  // /account/[addr] or /tx/[hash]. <th> (header labels) is left alone —
  // headers are usually column names, not data.
  // Both have displayName set so extractTableData can still find them
  // via matchType (used for the mobile card-stack rendering).
  td: Object.assign(
    function MdTd({ children }: { children?: React.ReactNode }) {
      return <td>{linkify(children)}</td>;
    },
    { displayName: "td" },
  ),
  // Custom <table> renders TWO views: a card-stack on mobile (extracted
  // from children) and the original table on desktop (with cell styling
  // applied via Tailwind arbitrary descendant selectors).
  table: ({ children }) => {
    const data = extractTableData(children);
    return (
      <div className="my-3 -mx-1">
        {/* Mobile card-stack — only renders when extraction succeeded. */}
        {data && (
          <div className="space-y-2 md:hidden">
            {data.rows.map((row, i) => (
              <div
                key={i}
                className="rounded-xl border border-elevated bg-bg/30 p-3"
              >
                <dl className="space-y-1.5">
                  {data.headers.map((header, j) => (
                    <div
                      key={j}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <dt className="shrink-0 font-display text-tag uppercase tracking-header text-muted">
                        {header}
                      </dt>
                      <dd className="text-right font-mono text-cell text-primary">
                        {linkify(row[j])}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}

        {/* Desktop real table. Cell styling via descendant selectors on
            the wrapper — keeps thead/tbody/tr/th/td as raw HTML so the
            extractTableData walk above can match them by string type. */}
        <div className="hidden overflow-x-auto rounded-lg border border-elevated md:block">
          <table className="[&_thead]:bg-bg/40 [&_tr]:border-b [&_tr]:border-elevated [&_tbody_tr:last-child]:border-b-0 [&_th]:whitespace-nowrap [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-mono [&_th]:text-tag [&_th]:uppercase [&_th]:tracking-header [&_th]:text-muted [&_td]:whitespace-nowrap [&_td]:px-3 [&_td]:py-2 [&_td]:font-mono [&_td]:text-cell [&_td]:text-primary">
            {children}
          </table>
        </div>
      </div>
    );
  },
};

export default function ProseAnswer({ markdown }: { markdown: string }) {
  return (
    <div className="font-body">
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
