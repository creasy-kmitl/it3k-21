import {
  LINK_UNAVAILABLE_HEADER,
  LINK_UNLOCK_HEADER,
  type LinkPageReason,
  isUnavailableReason,
} from "@it3k/db/short-link-rules";

type Fetch = (request: Request) => Promise<Response>;

/** Seconds a visitor's browser may wait before trying a failed link again. */
const RETRY_AFTER = "30";

/**
 * Answers `/l/<slug>` on the web host. The API decides: a redirect passes
 * straight through. A link that sends nobody on comes back with its reason in
 * LINK_UNAVAILABLE_HEADER, and is answered with this site's own page for that
 * reason, under the API's status (404 or 410) and at the address that was
 * scanned. If the API cannot answer at all (it throws or fails with a 5xx),
 * the visitor gets the "error" page with a 503, not a bare error.
 */
export async function answerShortLink(
  request: Request,
  api: Fetch,
  renderPage: Fetch,
  onError: (error: unknown) => void = () => {},
) {
  let response: Response | null = null;
  try {
    response = await api(request);
  } catch (error) {
    onError(error);
  }
  if (response && response.status < 500) {
    const reason = response.headers.get(LINK_UNAVAILABLE_HEADER);
    if (!isUnavailableReason(reason)) return response;
    const failure = response.headers.get(LINK_UNLOCK_HEADER);
    return (await page(request, reason, response.status, renderPage, failure)) ?? response;
  }
  if (response) onError(new Error(`Short link API answered ${response.status}`));
  return (
    (await page(request, "error", 503, renderPage)) ??
    new Response("ระบบลิงก์ขัดข้องชั่วคราว ลองใหม่อีกครั้ง", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": RETRY_AFTER },
    })
  );
}

/** This site's page for `reason`, or null if it could not be rendered. */
async function page(
  request: Request,
  reason: LinkPageReason,
  status: number,
  renderPage: Fetch,
  /** Why a typed password did not open a locked link, passed on to the page. */
  unlockFailure: string | null = null,
): Promise<Response | null> {
  // Rendered at the scanned address, so the page the browser hydrates matches
  // the route it finds there (`/l/$slug`), which reads the reason from here.
  const headers = new Headers(request.headers);
  headers.set(LINK_UNAVAILABLE_HEADER, reason);
  if (unlockFailure) headers.set(LINK_UNLOCK_HEADER, unlockFailure);
  else headers.delete(LINK_UNLOCK_HEADER);
  let rendered: Response;
  try {
    rendered = await renderPage(new Request(request.url, { headers }));
  } catch {
    return null;
  }
  if (!rendered.ok) return null;
  const pageHeaders = new Headers(rendered.headers);
  pageHeaders.set("Cache-Control", "no-store");
  pageHeaders.set("X-Robots-Tag", "noindex");
  if (status === 503) pageHeaders.set("Retry-After", RETRY_AFTER);
  if (status === 429) pageHeaders.set("Retry-After", "60");
  return new Response(request.method === "HEAD" ? null : rendered.body, {
    status,
    headers: pageHeaders,
  });
}
