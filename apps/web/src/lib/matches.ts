import {
  type AnnounceMode,
  type MatchStatus,
  type ScoringMode,
  UNIVERSITY_LABELS,
  type University,
} from "@it3k/db/match-rules";
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
  scheduled: "รอแข่งขัน",
  live: "กำลังแข่งขัน",
  finished: "สิ้นสุดการแข่งขัน",
};

export const SCORING_LABELS: Record<ScoringMode, string> = {
  points: "นับคะแนนสะสม",
  sets: "แบบเซต",
  after: "รายงานหลังจบการแข่งขัน",
};

export const SETS_TO_WIN_LABELS: Record<number, string> = {
  2: "2 ใน 3 เซต",
  3: "3 ใน 5 เซต",
  4: "4 ใน 7 เซต",
};

export const ANNOUNCE_LABELS: Record<AnnounceMode, string> = {
  live: "การแข่งขันแบบคู่",
  after: "การแข่งแบบหลายทีมพร้อมกัน (มากกว่า 2 ทีม)",
};

/** The two sides of a match announced live; none for one announced by ranking. */
export function sidesOf(match: { teamA: University | null; teamB: University | null }) {
  return match.teamA && match.teamB ? { a: match.teamA, b: match.teamB } : null;
}

export const universityLabel = (university: University) => UNIVERSITY_LABELS[university];

/** Someone else saved the match after this page read it. */
export function isStale(error: unknown) {
  return error instanceof ApiError && error.status === 409;
}
