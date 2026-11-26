import type { ScoreEventInput } from "@it3k/db/competition-rules";
import { hc } from "hono/client";
import type { ClientRequestOptions, InferRequestType, InferResponseType } from "hono/client";

import type { CompetitionScoreRoutes } from "../../../server/src/routes/competition-scores";
import { ENV } from "../env.public";

import { toApiError } from "./leadership";

/** The typed client the methods call. */
export type Client = ReturnType<typeof hc<CompetitionScoreRoutes>>;
type Match = Client[":matchId"];

export type Scoreboard = InferResponseType<Match["$get"], 200>;
export type ScoreboardSide = Scoreboard["sides"][number];
export type ScoreboardPlayer = ScoreboardSide["players"][number];
export type FinishMatchBody = InferRequestType<Match["finish"]["$post"]>["json"];
export type MatchResultBody = InferRequestType<Match["result"]["$post"]>["json"];

export function createCompetitionScoresApi(
  baseUrl: string,
  fetchImpl?: ClientRequestOptions["fetch"],
) {
  const client = hc<CompetitionScoreRoutes>(`${baseUrl}/api/competition/scores`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async get(matchId: string) {
      const res = await client[":matchId"].$get({ param: { matchId } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    /** Safe to send again: ids the match already has are skipped. */
    async addEvents(matchId: string, events: ScoreEventInput[]) {
      const res = await client[":matchId"].events.$post({ param: { matchId }, json: { events } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async voidEvent(matchId: string, eventId: string) {
      const res = await client[":matchId"].events[":eventId"].void.$post({
        param: { matchId, eventId },
        json: {},
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async start(matchId: string) {
      const res = await client[":matchId"].start.$post({ param: { matchId }, json: {} });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async finish(matchId: string, json: FinishMatchBody) {
      const res = await client[":matchId"].finish.$post({ param: { matchId }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async result(matchId: string, json: MatchResultBody) {
      const res = await client[":matchId"].result.$post({ param: { matchId }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type CompetitionScoresApi = ReturnType<typeof createCompetitionScoresApi>;

export const competitionScoresApi = createCompetitionScoresApi(ENV.VITE_SERVER_URL);
