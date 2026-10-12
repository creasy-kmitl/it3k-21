export const DEFAULT_REDIRECT = "/staff/dashboard";

// Only used to resolve `to`; a result on any other origin is rejected.
const BASE = "http://local.invalid";

/**
 * Where to go after signing in. `to` comes from the URL, so anything that is
 * not a path on this site (`//host`, `/\host`, `https://host`) falls back to
 * the dashboard instead of sending the visitor to another origin.
 */
export function safeRedirect(to: unknown): string {
  if (typeof to !== "string" || !to.startsWith("/")) return DEFAULT_REDIRECT;
  try {
    // Parsed the way a browser would, which drops tabs and treats `\` as `/`.
    const url = new URL(to, BASE);
    if (url.origin !== BASE) return DEFAULT_REDIRECT;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_REDIRECT;
  }
}
