import { describe, expect, it } from "vitest";
import { citationFromHref, extractCitations, linkifyCitations } from "@/lib/citations";

describe("citations", () => {
  it("turns [Policy §x.y] markers into hash links and back", () => {
    const md = linkifyCitations("Within 30 days [Policy §2.1] and once [Policy § 3.3].");
    expect(md).toContain("[Policy §2.1](#cite-%C2%A72.1)");
    expect(md).toContain("[Policy §3.3](#cite-%C2%A73.3)");
    expect(citationFromHref("#cite-%C2%A72.1")).toBe("§2.1");
    expect(citationFromHref("https://example.com")).toBeNull();
  });

  it("extracts unique section ids", () => {
    expect(extractCitations("[Policy §2.1] … [Policy §2.1] … [Policy §10.2.1]")).toEqual(["§2.1", "§10.2.1"]);
  });

  it("leaves other brackets alone", () => {
    expect(linkifyCitations("[not a policy] [Policy x]")).toBe("[not a policy] [Policy x]");
  });
});
