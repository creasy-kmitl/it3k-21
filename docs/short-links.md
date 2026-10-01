# Short links: how they work and what to do when they break

Staff make short links at `/staff/links`. Each one lives at `https://it3k.creasy.club/l/<slug>` and sends visitors to its destination, which staff can change at any time without reprinting the QR codes that point at it. This page is the runbook for when something goes wrong.

**Owner:** Tech/Live. Name the person on call for event days in issue #13.

## How a visit is answered

1. The web worker gets `/l/<slug>` and hands the request to the API worker through the `SERVER` service binding (`apps/web/src/server.ts`, `apps/web/src/lib/short-link-proxy.ts`).
2. The API looks the slug up in D1 (`apps/server/src/routes/links/redirect.ts`):
   - **Active link:** `302` to the destination, `Cache-Control: private, no-store`. Nothing caches it, so a new destination takes effect at once.
   - **Switched off or expired, with a fallback URL:** `302` to the fallback. Not counted.
   - **Active with a password:** `403` with reason `locked`. The web page shows a password form that posts back to the same address (the `?qr` marker is kept). The right password redirects and counts the visit. A wrong one comes back with `X-Short-Link-Unlock: wrong`. After 10 wrong tries on a link in one minute, the API stops checking until the minute is over (`429`, `limited`).
   - **Switched off, expired or unknown, without a fallback:** `410` or `404`, with the reason in `X-Short-Link-Unavailable`. The web worker renders its own page for that reason at the same address (`apps/web/src/routes/l/$slug.tsx`).
3. If the API throws or answers `5xx`, the web worker logs the error and serves the "ขัด·ข้อง" page with `503` and `Retry-After: 30`. Visitors are never shown a bare error.

Visits are counted after the response (`waitUntil`), so a failed count never delays or breaks a redirect.

## What is stored

- `short_link`: slug, title, destination, fallback URL, tags, on/off, expiry, owner, version.
- `short_link_change`: every create and edit, with who made it and each field's before and after values. It is append-only and has no foreign keys, so it outlives accounts.
- `short_link.password_hash`: PBKDF2-SHA-256 with a random salt and 10,000 iterations. The count is low because every unlock hashes inside a Worker's CPU budget. The per-link attempt limit is what holds back guessing. Passwords are never returned by the API or written to the change log, which records only whether a password is set.
- `short_link_unlock_attempt`: wrong passwords per link per minute. No visitor detail is stored, so an attack on one link locks it for everyone until the minute ends.
- `qr_preset`: named QR designs, logo included, shared with every member. The owner, admins and Tech/Live can edit or delete them.
- `short_link_visit_day`: one count per link, per Bangkok day, per source (`qr` or `link`). There is no IP address, user agent, referrer or location, so no visitor can be identified and no consent is needed. Bots and chat link previews are not counted. Counts are page opens, not people.

## Who can change what

- Every staff member can create links and edit their own.
- Admins and members of Tech/Live can edit every link.
- Slugs never change, because they are printed in QR codes. Links are never deleted. Switch a link off instead.
- Destinations and fallbacks must be `https://` URLs with no `user:password@` part, and must not point at another short link.

## Working with many links

- **Bulk create** (`/staff/links`, the arrow next to "สร้างลิงก์"): paste rows from Google Sheets or Excel, or upload a CSV, with up to 100 rows. Columns are `title` and `destination` (required), plus `slug`, `tags` (separated by `|`) and `fallback_url`. Thai headers work too. Every row is checked before anything is sent. The API checks again, and creates all rows or none.
- **QR codes as a zip:** after a bulk create, or from "ส่งออก" for the links currently shown. Each file is named after its slug, and `links.csv` maps files to links. The design is a team preset, the design last used in QR Studio on that browser, or plain black on white.
- **Reports:** "ส่งออก" also downloads the shown links as CSV, and daily visits for the last 90 days as CSV (filtered by tag and "ของฉัน", not by search text). Files start with a byte-order mark so Excel reads Thai correctly.

## When something breaks

| Symptom                                                               | Check                                                                                                                                                                                                                   | Do                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A link's destination is down (the form is closed, the site is broken) | Open the destination yourself.                                                                                                                                                                                          | Edit the link to a working destination, or switch it off. If it has a fallback URL, visitors go there while it is off.                                                                                   |
| A link goes somewhere wrong or harmful                                | The link's history in its panel shows who changed what and when.                                                                                                                                                        | Switch it off at once, then fix the destination and switch it back on.                                                                                                                                   |
| Every link shows "ขัด·ข้อง" (503)                                     | Search Axiom for `service:it3k-web` errors saying "Short link API answered", or for `service:it3k-server` with `path` starting `/l/` and `status >= 500`. Check the Cloudflare status page for Workers or D1 incidents. | If the API worker is broken by a deploy, roll it back (revert on `main`, then PR to `prod`). If D1 is down, nothing in the app can redirect. Post a temporary direct URL on the event's social channels. |
| Every link shows 404                                                  | Is the slug right? Was the link made on a different stage (staging vs prod)?                                                                                                                                            | Links made on staging only exist on staging. Recreate the link on prod.                                                                                                                                  |
| Someone says the password does not work                               | The link's history shows when the password was last changed. If "รอประมาณหนึ่งนาที" appears, the link is being guessed at.                                                                                              | Set a new password and share it again. If the guessing continues, switch the link off and make a new one.                                                                                                |
| Visits look too low                                                   | Previews and bots are left out by design. Someone who copies the QR's URL into a chat is counted under QR.                                                                                                              | Nothing to fix. Explain that counts are page opens through each source.                                                                                                                                  |

## Monitoring

Every request already reaches Axiom through evlog, tagged with `environment` (the stage) and `service`. Two queries are worth an alert on event days:

- `service == "it3k-web"` with `level == "error"` and a message mentioning the short link API: the API could not answer.
- `service == "it3k-server"`, `path` starting with `/l/`, `status >= 500`: the redirect itself failed.

Before an event, open every printed link once from a phone on mobile data, and keep this page and the staff `/staff/links` page bookmarked.
