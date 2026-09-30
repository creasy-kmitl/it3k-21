import { hc } from "hono/client";
import type { ClientRequestOptions, InferResponseType } from "hono/client";

import type { PublicCalendarRoutes } from "../../../server/src/routes/public-calendar";
import { ENV } from "../env.public";
import { toApiError } from "./leadership";

type Client = ReturnType<typeof hc<PublicCalendarRoutes>>;

export type PublicCalendarPage = InferResponseType<Client["index"]["$get"], 200>;
export type PublicCalendarItem = PublicCalendarPage["items"][number];

/** The sign-in-free calendar API: approved, confirmed live operations only. */
export function createPublicCalendarApi(
  baseUrl: string,
  fetchImpl?: ClientRequestOptions["fetch"],
) {
  const client = hc<PublicCalendarRoutes>(`${baseUrl}/api/public/calendar`, { fetch: fetchImpl });
  return {
    async list(range: { from?: number; to?: number } = {}) {
      const res = await client.index.$get({
        query: {
          ...(range.from ? { from: String(range.from) } : {}),
          ...(range.to ? { to: String(range.to) } : {}),
        },
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    /** The iCalendar subscription URL, for calendar apps. */
    feedUrl: `${baseUrl}/api/public/calendar/calendar.ics`,
  };
}

export const publicCalendarApi = createPublicCalendarApi(ENV.VITE_SERVER_URL);
