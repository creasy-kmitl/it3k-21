// Match check-in: a match's kiosk scans, and the match page's ticks and forfeits.
import { hc } from "hono/client";
import type { ClientRequestOptions, InferResponseType } from "hono/client";

import type { CompetitionCheckinRoutes } from "../../../server/src/routes/competition-checkins";
import { ENV } from "../env.public";

import { ApiError, toApiError } from "./leadership";

/** The typed client the methods call. */
export type Client = ReturnType<typeof hc<CompetitionCheckinRoutes>>;

export type MatchCheckins = InferResponseType<Client["matches"][":matchId"]["$get"], 200>;
export type RosterSide = MatchCheckins["match"]["sides"][number];
export type RosterEntry = RosterSide["roster"][number];

type ScanSuccess = InferResponseType<Client["matches"][":matchId"]["scan"]["$post"], 200 | 201>;
export type ScanPerson = ScanSuccess["person"];
/** A match with each side's count, without the rosters. */
export type CheckinMatch = ScanSuccess["match"];
export type CheckinSide = CheckinMatch["sides"][number];

/** What one scan at the kiosk came to: checked in, already in, or why not. */
export type ScanOutcome =
  | ScanSuccess
  | {
      code:
        | "ticket"
        | "unknown"
        | "manual"
        | "match-closed"
        | "not-in-match"
        | "not-in-lineup"
        | "too-early"
        | "closed";
      message: string;
      person?: ScanPerson | null;
      match?: CheckinMatch | null;
      opensAt?: string;
    };

const OUTCOME_CODES = new Set([
  "checked-in",
  "duplicate",
  "ticket",
  "unknown",
  "manual",
  "match-closed",
  "not-in-match",
  "not-in-lineup",
  "too-early",
  "closed",
]);

const isOutcome = (body: unknown): body is ScanOutcome =>
  !!body &&
  typeof body === "object" &&
  "code" in body &&
  typeof body.code === "string" &&
  OUTCOME_CODES.has(body.code);

export function createCompetitionCheckinsApi(
  baseUrl: string,
  fetchImpl?: ClientRequestOptions["fetch"],
) {
  const client = hc<CompetitionCheckinRoutes>(`${baseUrl}/api/competition/checkins`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    /** A scanned code; refusals the kiosk shows come back as outcomes, not errors. */
    async scan(matchId: string, code: string): Promise<ScanOutcome> {
      const res = await client.matches[":matchId"].scan.$post({
        param: { matchId },
        json: { code },
      });
      const body: unknown = await res.json().catch(() => null);
      if (isOutcome(body)) return body;
      const message =
        body && typeof body === "object" && "message" in body && typeof body.message === "string"
          ? body.message
          : `Request failed (${res.status})`;
      throw new ApiError(res.status, message, body);
    },
    async match(matchId: string) {
      const res = await client.matches[":matchId"].$get({ param: { matchId } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async checkIn(matchId: string, participantId: string, userId: string) {
      const res = await client.matches[":matchId"].checkins.$post({
        param: { matchId },
        json: { participantId, userId },
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async undo(matchId: string, userId: string) {
      const res = await client.matches[":matchId"].checkins[":userId"].$delete({
        param: { matchId, userId },
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async forfeit(matchId: string, participantIds: string[], version: number) {
      const res = await client.matches[":matchId"].forfeit.$post({
        param: { matchId },
        json: { participantIds, version },
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type CompetitionCheckinsApi = ReturnType<typeof createCompetitionCheckinsApi>;

export const competitionCheckinsApi = createCompetitionCheckinsApi(ENV.VITE_SERVER_URL);
