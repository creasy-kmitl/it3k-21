// Passwords on short links, stored as PBKDF2-SHA-256 hashes with a random salt.
// The iteration count is modest on purpose: every visit to a locked link
// hashes once inside a Worker's CPU budget, and guessing is held back by the
// per-link attempt limit rather than by hashing cost alone.

const ITERATIONS = 10_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password.normalize("NFC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

/** `pbkdf2$<iterations>$<salt>$<hash>`, salt and hash in base64. */
export async function hashLinkPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** Whether `password` matches `stored`, compared in constant time. */
export async function verifyLinkPassword(password: string, stored: string) {
  const [scheme, iterations, salt, expected] = stored.split("$");
  if (scheme !== "pbkdf2" || !iterations || !salt || !expected) return false;
  const actual = await derive(password, fromBase64(salt), Number(iterations));
  const wanted = fromBase64(expected);
  if (actual.length !== wanted.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= (actual[i] ?? 0) ^ (wanted[i] ?? 0);
  return difference === 0;
}
