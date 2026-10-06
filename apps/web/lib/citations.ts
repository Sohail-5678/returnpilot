/**
 * Assistant text cites policy like "[Policy §2.1]". We rewrite those markers into
 * markdown links with a hash URL so react-markdown keeps them, then render the
 * link as a button that opens the policy side sheet.
 */
const CITATION_RE = /\[Policy\s+(§\s?\d+(?:\.\d+)*)\]/g;
export const CITE_PREFIX = "#cite-";

export function linkifyCitations(text: string): string {
  return text.replace(CITATION_RE, (_m, sec: string) => {
    const id = sec.replace(/\s+/g, "");
    return `[Policy ${id}](${CITE_PREFIX}${encodeURIComponent(id)})`;
  });
}

export function citationFromHref(href: string | undefined | null): string | null {
  if (!href) return null;
  const idx = href.indexOf(CITE_PREFIX);
  if (idx === -1) return null;
  try {
    return decodeURIComponent(href.slice(idx + CITE_PREFIX.length));
  } catch {
    return null;
  }
}

export function extractCitations(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(CITATION_RE)) out.add(m[1]!.replace(/\s+/g, ""));
  return [...out];
}
