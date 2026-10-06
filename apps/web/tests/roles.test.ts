import { describe, expect, it } from "vitest";
import { apiAccess, canAccessPage, homeFor, isProtectedPage, navFor, safeNextPath } from "@/lib/roles";

describe("page rules", () => {
  it("public pages are open to everyone", () => {
    for (const p of ["/", "/login", "/about"]) {
      expect(isProtectedPage(p)).toBe(false);
      expect(canAccessPage(null, p)).toBe(true);
    }
  });

  it("customers: chat, orders, memory and their own runs — not reviews or admin", () => {
    for (const p of ["/chat", "/chat/abc", "/orders", "/orders/1042", "/memory", "/runs", "/runs/r1"]) {
      expect(canAccessPage("customer", p)).toBe(true);
    }
    for (const p of ["/reviews", "/reviews/a1", "/admin"]) expect(canAccessPage("customer", p)).toBe(false);
  });

  it("reviewers: only the review queue", () => {
    expect(canAccessPage("reviewer", "/reviews")).toBe(true);
    expect(canAccessPage("reviewer", "/reviews/a1")).toBe(true);
    for (const p of ["/chat", "/orders", "/memory", "/runs", "/admin"]) expect(canAccessPage("reviewer", p)).toBe(false);
  });

  it("admins: reviews, runs and admin — no customer pages", () => {
    for (const p of ["/reviews", "/runs/r1", "/admin"]) expect(canAccessPage("admin", p)).toBe(true);
    for (const p of ["/chat", "/orders", "/memory"]) expect(canAccessPage("admin", p)).toBe(false);
  });

  it("signed-out users can't open app pages", () => {
    expect(canAccessPage(null, "/chat")).toBe(false);
    expect(isProtectedPage("/admin")).toBe(true);
  });

  it("prefix matching doesn't leak to look-alike paths", () => {
    expect(isProtectedPage("/chatter")).toBe(false);
    expect(canAccessPage("reviewer", "/administrator")).toBe(true); // unknown path → 404, not a role rule
  });

  it("sends each role to its home", () => {
    expect(homeFor("customer")).toBe("/chat");
    expect(homeFor("reviewer")).toBe("/reviews");
    expect(homeFor("admin")).toBe("/admin");
    expect(homeFor(null)).toBe("/login");
  });

  it("nav matches the rules", () => {
    expect(navFor("customer").map((n) => n.href)).toEqual(["/chat", "/orders", "/memory", "/runs"]);
    expect(navFor("reviewer").map((n) => n.href)).toEqual(["/reviews"]);
    expect(navFor("admin").map((n) => n.href)).toEqual(["/reviews", "/runs", "/admin"]);
  });
});

describe("API proxy rules", () => {
  it("allows each role only its prefixes", () => {
    expect(apiAccess("customer", ["threads", "t1", "messages"])).toBe("ok");
    expect(apiAccess("customer", ["approvals"])).toBe("forbidden");
    expect(apiAccess("customer", ["admin", "metrics"])).toBe("forbidden");
    expect(apiAccess("reviewer", ["approvals", "a1", "decision"])).toBe("ok");
    expect(apiAccess("reviewer", ["threads"])).toBe("forbidden");
    expect(apiAccess("reviewer", ["runs"])).toBe("forbidden");
    expect(apiAccess("admin", ["runs", "r1"])).toBe("ok");
    expect(apiAccess("admin", ["orders"])).toBe("forbidden");
  });

  it("everyone can read /me and policies", () => {
    for (const r of ["customer", "reviewer", "admin"] as const) {
      expect(apiAccess(r, ["me"])).toBe("ok");
      expect(apiAccess(r, ["policies", "§2.1"])).toBe("ok");
    }
  });

  it("rejects unknown prefixes and missing roles", () => {
    expect(apiAccess("admin", ["internal", "cron"])).toBe("not_found");
    expect(apiAccess("admin", [])).toBe("not_found");
    expect(apiAccess(null, ["me"])).toBe("forbidden");
  });
});

describe("safeNextPath", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNextPath("/chat/123?x=1")).toBe("/chat/123?x=1");
  });
  it("blocks open redirects and loops", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil", "javascript:alert(1)", "/login", "/api/v1/me", "", null]) {
      expect(safeNextPath(bad)).toBeNull();
    }
  });
});
