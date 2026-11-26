import type { Institution } from "@it3k/db/profile";
import type { TeamAutoInput } from "@it3k/db/team-rules";
import type { lineupInput, teamCreateInput, teamOfficialInput } from "@it3k/db/competition-rules";
import { hc } from "hono/client";
import type { ClientRequestOptions, InferResponseType } from "hono/client";
import type { z } from "zod";

import type { CompetitionTeamRoutes } from "../../../server/src/routes/competition-teams";
import { ENV } from "../env.public";

import { toApiError } from "./leadership";

/** The typed client the methods call. */
export type Client = ReturnType<typeof hc<CompetitionTeamRoutes>>;

export type TeamList = InferResponseType<Client["index"]["$get"], 200>;
export type Team = TeamList["items"][number];
export type TeamMember = Team["members"][number];
export type TeamOfficial = Team["officials"][number];
export type DivisionTeamsPage = InferResponseType<Client["division"][":divisionId"]["$get"], 200>;
export type TeamDivision = DivisionTeamsPage["division"];
export type TeamAthlete = DivisionTeamsPage["athletes"][number];
export type LineupPage = InferResponseType<
  Client["lineups"][":matchId"][":participantId"]["$get"],
  200
>;
export type TeamOfficialInput = z.infer<typeof teamOfficialInput>;

export function createCompetitionTeamsApi(
  baseUrl: string,
  fetchImpl?: ClientRequestOptions["fetch"],
) {
  const client = hc<CompetitionTeamRoutes>(`${baseUrl}/api/competition/teams`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async list(query: { divisionId?: string; institution?: Institution } = {}) {
      const res = await client.index.$get({ query });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async division(divisionId: string, institution?: Institution) {
      const res = await client.division[":divisionId"].$get({
        param: { divisionId },
        query: institution ? { institution } : {},
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async create(json: z.infer<typeof teamCreateInput>) {
      const res = await client.index.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async auto(json: TeamAutoInput) {
      const res = await client.auto.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async rename(id: string, json: { name: string | null; version: number }) {
      const res = await client[":id"].$patch({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async remove(id: string) {
      const res = await client[":id"].$delete({ param: { id } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async saveMembers(id: string, json: { registrationIds: string[]; version: number }) {
      const res = await client[":id"].members.$put({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async addOfficial(id: string, json: TeamOfficialInput) {
      const res = await client[":id"].officials.$post({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async updateOfficial(id: string, officialId: string, json: TeamOfficialInput) {
      const res = await client[":id"].officials[":officialId"].$put({
        param: { id, officialId },
        json,
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async removeOfficial(id: string, officialId: string) {
      const res = await client[":id"].officials[":officialId"].$delete({
        param: { id, officialId },
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async lineup(matchId: string, participantId: string) {
      const res = await client.lineups[":matchId"][":participantId"].$get({
        param: { matchId, participantId },
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async saveLineup(matchId: string, participantId: string, json: z.infer<typeof lineupInput>) {
      const res = await client.lineups[":matchId"][":participantId"].$put({
        param: { matchId, participantId },
        json,
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type CompetitionTeamsApi = ReturnType<typeof createCompetitionTeamsApi>;

export const competitionTeamsApi = createCompetitionTeamsApi(ENV.VITE_SERVER_URL);
