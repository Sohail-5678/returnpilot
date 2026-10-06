import "server-only";
import { importPKCS8, SignJWT, type CryptoKey } from "jose";
import type { AppUser } from "@/auth";

/**
 * Mints the short-lived ES256 JWT the backend verifies (API_CONTRACT §1).
 * The browser never sees this token.
 */
export interface BackendClaims {
  sub: string;
  role: AppUser["role"];
  persona: AppUser["persona"];
  ws: string;
  name: string;
  login?: string;
  sid: string;
}

let cached: { raw: string; key: Promise<CryptoKey> } | null = null;

function signingKey(raw: string) {
  if (!raw) throw new Error("JWT_PRIVATE_KEY is not set");
  if (cached?.raw !== raw) {
    const pem = Buffer.from(raw, "base64").toString("utf8");
    cached = { raw, key: importPKCS8(pem, "ES256") };
  }
  return cached.key;
}

export function claimsFor(user: AppUser, ws: string): BackendClaims {
  const claims: BackendClaims = {
    sub: user.sub,
    role: user.role,
    persona: user.persona,
    ws,
    name: user.name,
    sid: user.sid,
  };
  if (user.login) claims.login = user.login;
  return claims;
}

export async function mintBackendToken(
  claims: BackendClaims,
  privateKeyB64: string = process.env.JWT_PRIVATE_KEY ?? "",
): Promise<string> {
  const key = await signingKey(privateKeyB64);
  const { sub, ...rest } = claims;
  return new SignJWT({ ...rest })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer("returnpilot-web")
    .setAudience("returnpilot-api")
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}
