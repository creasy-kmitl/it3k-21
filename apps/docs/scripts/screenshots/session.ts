import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Better Auth's session cookie on http://localhost (no `__Secure-` prefix). */
export const SESSION_COOKIE = "better-auth.session_token";
export const API_URL = process.env.SCREENSHOT_API_URL ?? "http://localhost:3000";
export const WEB_URL = process.env.SCREENSHOT_WEB_URL ?? "http://localhost:3001";

/** The local API's signing secret, read from apps/server/.env and never printed. */
export function readAuthSecret(): string {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  const file = resolve(import.meta.dirname, "../../../server/.env");
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith("BETTER_AUTH_SECRET="));
  const value = line
    ?.slice("BETTER_AUTH_SECRET=".length)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`BETTER_AUTH_SECRET is not set in ${file}`);
  return value;
}

/**
 * The cookie value Better Auth expects: `<token>.<base64 HMAC-SHA256>`, URL
 * encoded, as better-call's `signCookieValue` writes it.
 */
export async function signedSessionCookie(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return encodeURIComponent(`${token}.${base64}`);
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "")
    .replaceAll("/", "")
    .replaceAll("=", "")
    .slice(0, 32);
}
