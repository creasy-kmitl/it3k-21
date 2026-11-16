// Link previews (Open Graph) for pages people share: /events, one event, and
// a ticket. Those pages render only in the browser (`ssr: false`) behind a
// sign-in, but chat apps and social sites fetch previews signed out and run
// no JavaScript. So the root route, which always renders on the server,
// looks the page up through the public preview API and puts its tags in the
// document head. The QR and anything about the viewer stay out of previews.
import { createIsomorphicFn } from "@tanstack/react-start";

import { ENV } from "../env.public";
import { formatBangkok, formatRange } from "./bangkok-time";
import { fetchServer } from "./server-binding";

/** What a shared link shows. `image` is absolute, or null for the site picture. */
export type PageOg = { title: string; description: string; image: string | null };

/** GET /api/public/events/:ref */
export type PublicEvent = {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  startAt: string;
  endAt: string;
  thumbnailUrl: string | null;
  venue: string | null;
};

/** GET /api/public/events */
export type PublicEventList = {
  total: number;
  items: { name: string; thumbnailUrl: string | null }[];
};

export type PreviewTarget = { kind: "events" } | { kind: "event" | "ticket"; ref: string };

/** Which shared page a path is, when it has a preview of its own. */
export function previewTarget(pathname: string): PreviewTarget | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/events") return { kind: "events" };
  const match = /^\/(events|tickets)\/([^/]+)$/.exec(path);
  if (!match?.[2]) return null;
  try {
    const ref = decodeURIComponent(match[2]);
    return { kind: match[1] === "events" ? "event" : "ticket", ref };
  } catch {
    return null;
  }
}

/** An http(s) URL for a picture, resolving one relative to the API. */
export function absoluteImage(url: string | null, base: string) {
  if (!url) return null;
  try {
    const resolved = new URL(url, base);
    return resolved.protocol === "https:" || resolved.protocol === "http:" ? resolved.href : null;
  } catch {
    return null;
  }
}

/** One event, or a ticket to it (which never shows the QR). */
export function eventOg(item: PublicEvent, kind: "event" | "ticket", apiBase: string): PageOg {
  const start = Date.parse(item.startAt);
  const facts = [
    `${formatBangkok(start, "date")} ${formatRange(start, Date.parse(item.endAt))} น.`,
    item.venue,
  ].filter(Boolean);
  const description =
    kind === "ticket"
      ? `ตั๋วเข้างาน · ${facts.join(" · ")}`
      : [facts.join(" · "), item.description].filter(Boolean).join(" — ");
  return {
    title: kind === "ticket" ? `ตั๋ว ${item.name}` : item.name,
    description,
    image: absoluteImage(item.thumbnailUrl, apiBase),
  };
}

/** The events page: what takes tickets now, soonest first. */
export function eventsOg(list: PublicEventList, apiBase: string): PageOg {
  const names = list.items.map((item) => item.name);
  const more = list.total > names.length ? " และอื่น ๆ" : "";
  const cover = list.items.find((item) => item.thumbnailUrl)?.thumbnailUrl ?? null;
  return {
    title: "กิจกรรม",
    description:
      list.total === 0
        ? "รับตั๋วกิจกรรมของ IT3Kings แล้วแสดง QR ที่จุดเช็คอินหน้างาน"
        : `เปิดรับตั๋ว ${list.total.toLocaleString("th-TH")} กิจกรรม: ${names.join(", ")}${more}`,
    image: absoluteImage(cover, apiBase),
  };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    // A preview is worth little next to a slow page; give up quickly.
    const res = await fetchServer(url, { signal: AbortSignal.timeout(2000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The page's preview, or null for the site's own. Server only: browsers skip it. */
export const loadPageOg = createIsomorphicFn()
  .server(async (pathname: string): Promise<PageOg | null> => {
    const target = previewTarget(pathname);
    if (!target) return null;
    const api = `${ENV.VITE_SERVER_URL}/api/public/events`;
    if (target.kind === "events") {
      const list = await fetchJson<PublicEventList>(api);
      return list ? eventsOg(list, api) : null;
    }
    const item = await fetchJson<PublicEvent>(`${api}/${encodeURIComponent(target.ref)}`);
    return item ? eventOg(item, target.kind, api) : null;
  })
  .client(async (_pathname: string): Promise<PageOg | null> => null);
