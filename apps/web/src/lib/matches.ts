import { type MatchStatus, UNIVERSITY_LABELS, type University } from "@it3k/db/match-rules";
import { hc } from "hono/client";
import type { ClientRequestOptions, InferRequestType, InferResponseType } from "hono/client";

import type { MatchRoutes, PublicScoreRoutes } from "../../../server/src/routes/matches";
import { ENV } from "../env.public";
import { ApiError, toApiError } from "./leadership";

type Client = ReturnType<typeof hc<MatchRoutes>>;
type PublicClient = ReturnType<typeof hc<PublicScoreRoutes>>;

export type Match = InferResponseType<Client["index"]["$get"], 200>["items"][number];
export type MatchInput = InferRequestType<Client["index"]["$post"]>["json"];
export type MatchUpdate = InferRequestType<Client[":id"]["$patch"]>["json"];
export type Scoreboard = InferResponseType<PublicClient["index"]["$get"], 200>;
export type PublicMatch = Scoreboard["matches"][number];

export function createMatchesApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<MatchRoutes>(`${baseUrl}/api/matches`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async list() {
      const res = await client.index.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async create(json: MatchInput) {
      const res = await client.index.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async update(id: string, json: MatchUpdate) {
      const res = await client[":id"].$patch({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async remove(id: string, version: number) {
      const res = await client[":id"].$delete({
        param: { id },
        query: { version: String(version) },
      });
      if (!res.ok) throw await toApiError(res);
    },
  };
}

export type MatchesApi = ReturnType<typeof createMatchesApi>;

export const matchesApi = createMatchesApi(ENV.VITE_SERVER_URL);

/** The scoreboard needs no session, so it sends no cookies. */
export function createPublicScoresApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<PublicScoreRoutes>(`${baseUrl}/api/public/scores`, { fetch: fetchImpl });
  return {
    async get() {
      const res = await client.index.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type PublicScoresApi = ReturnType<typeof createPublicScoresApi>;

export const publicScoresApi = createPublicScoresApi(ENV.VITE_SERVER_URL);

export const STATUS_LABELS: Record<MatchStatus, string> = {
  scheduled: "ยังไม่แข่ง",
  live: "กำลังแข่ง",
  finished: "จบแล้ว",
};

export const universityLabel = (university: University) => UNIVERSITY_LABELS[university];

/** Someone else saved the match after this page read it. */
export function isStale(error: unknown) {
  return error instanceof ApiError && error.status === 409;
}
