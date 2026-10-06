import { exportPKCS8, exportSPKI, generateKeyPair, importSPKI, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import type { AppUser } from "@/auth";
import { claimsFor, mintBackendToken } from "@/lib/server/backend-token";

describe("mintBackendToken (API_CONTRACT §1)", () => {
  it("signs an ES256 JWT with the contract claims and a 5-minute expiry", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const privB64 = Buffer.from(await exportPKCS8(privateKey)).toString("base64");
    const pub = await importSPKI(await exportSPKI(publicKey), "ES256");

    const user: AppUser = { sub: "demo:maya", role: "customer", persona: "maya", name: "Maya Patel", login: null, sid: "s-1", image: null };
    const ws = "6f1c2b9a-1d2e-4f3a-9b8c-7d6e5f4a3b2c";
    const token = await mintBackendToken(claimsFor(user, ws), privB64);

    const { payload, protectedHeader } = await jwtVerify(token, pub, { issuer: "returnpilot-web", audience: "returnpilot-api" });
    expect(protectedHeader.alg).toBe("ES256");
    expect(payload).toMatchObject({ sub: "demo:maya", role: "customer", persona: "maya", ws, name: "Maya Patel", sid: "s-1" });
    expect(payload).not.toHaveProperty("login");
    expect(payload.exp! - payload.iat!).toBe(300);
  });

  it("includes login for GitHub users and a null persona", async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const privB64 = Buffer.from(await exportPKCS8(privateKey)).toString("base64");
    const user: AppUser = { sub: "github:42", role: "admin", persona: null, name: "Octo Cat", login: "octocat", sid: "s-2", image: null };
    const token = await mintBackendToken(claimsFor(user, "ws"), privB64);
    const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
    expect(payload).toMatchObject({ sub: "github:42", role: "admin", persona: null, login: "octocat" });
  });

  it("fails loudly without a key", async () => {
    const user: AppUser = { sub: "demo:maya", role: "customer", persona: "maya", name: "Maya", login: null, sid: "s", image: null };
    await expect(mintBackendToken(claimsFor(user, "ws"), "")).rejects.toThrow(/JWT_PRIVATE_KEY/);
  });
});
