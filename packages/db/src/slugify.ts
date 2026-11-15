// Turning names into URL slugs. Shared by the API and the web app, so it is
// kept free of Drizzle.

const COMBINING_MARKS = /[̀-ͯ]/g;
const THAI_DIGITS = /[๐-๙]/g;

/**
 * A URL-safe form of `text`: lowercase ASCII letters and digits joined by
 * single hyphens. Accents are dropped ("Café" → "cafe"), Thai digits become
 * ASCII ones, apostrophes vanish ("It's" → "its"), and everything else,
 * Thai letters included, separates words. Thai is not transliterated: a
 * romanization that people would recognize needs word breaking and a
 * dictionary, so a name with no Latin letters gives "".
 *
 * `keepTrailingHyphen` is for a field being typed into, where the hyphen
 * the user just typed has to stay until the next word follows it.
 */
export function slugify(text: string, { keepTrailingHyphen = false } = {}): string {
  const slug = text
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .replace(THAI_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0e50))
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "");
  return keepTrailingHyphen ? slug : slug.replace(/-+$/, "");
}

/** The shape of a `crypto.randomUUID()` id. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
