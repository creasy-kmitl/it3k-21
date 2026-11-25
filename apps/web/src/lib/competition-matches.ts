import type {
  MatchInput,
  RoundRobinInput,
  groupInput,
  matchImageInput,
  matchStatusInput,
  placementsInput,
  refereeInput,
} from "@it3k/db/competition-rules";
import { hc } from "hono/client";
import type { ClientRequestOptions, InferResponseType } from "hono/client";
import type { z } from "zod";

import type { CompetitionMatchRoutes } from "../../../server/src/routes/competition-matches";
import { ENV } from "../env.public";

import { toApiError } from "./leadership";

/** The typed client the methods call. */
export type Client = ReturnType<typeof hc<CompetitionMatchRoutes>>;

export type MatchList = InferResponseType<Client["index"]["$get"], 200>;
export type MatchListItem = MatchList["items"][number];
export type MatchSide = MatchListItem["participants"][number];
export type MatchDetailResponse = InferResponseType<Client[":id"]["$get"], 200>;
export type MatchDetail = MatchDetailResponse["match"];
export type MatchSetup = InferResponseType<Client["setup"][":divisionId"]["$get"], 200>;
export type MatchGroup = MatchSetup["groups"][number];
export type SchedulePlan = InferResponseType<Client["schedule"]["preview"]["$post"], 200>["plan"];
export type PlannedMatchRow = SchedulePlan["matches"][number];

export type MatchFilters = {
  sportId?: string;
  divisionId?: string;
  venueId?: string;
  status?: MatchListItem["status"];
};

export function createCompetitionMatchesApi(
  baseUrl: string,
  fetchImpl?: ClientRequestOptions["fetch"],
) {
  const client = hc<CompetitionMatchRoutes>(`${baseUrl}/api/competition/matches`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async list(filters: MatchFilters = {}) {
      const res = await client.index.$get({ query: filters });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async setup(divisionId: string) {
      const res = await client.setup[":divisionId"].$get({ param: { divisionId } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async get(id: string) {
      const res = await client[":id"].$get({ param: { id } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async create(json: MatchInput) {
      const res = await client.index.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async update(id: string, json: MatchInput & { version: number }) {
      const res = await client[":id"].$put({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async remove(id: string, version: number) {
      const res = await client[":id"].$delete({
        param: { id },
        query: { version: String(version) },
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async setStatus(id: string, json: z.infer<typeof matchStatusInput>) {
      const res = await client[":id"].status.$post({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async assignTeam(id: string, participantId: string, json: { teamId: string; version: number }) {
      const res = await client[":id"].participants[":participantId"].team.$post({
        param: { id, participantId },
        json,
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async addReferee(id: string, json: z.infer<typeof refereeInput>) {
      const res = await client[":id"].referees.$post({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async updateReferee(id: string, refereeId: string, json: z.infer<typeof refereeInput>) {
      const res = await client[":id"].referees[":refereeId"].$put({
        param: { id, refereeId },
        json,
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async removeReferee(id: string, refereeId: string) {
      const res = await client[":id"].referees[":refereeId"].$delete({
        param: { id, refereeId },
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async addImage(id: string, json: z.infer<typeof matchImageInput>) {
      const res = await client[":id"].images.$post({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async updateImage(id: string, imageId: string, json: z.infer<typeof matchImageInput>) {
      const res = await client[":id"].images[":imageId"].$put({ param: { id, imageId }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async removeImage(id: string, imageId: string) {
      const res = await client[":id"].images[":imageId"].$delete({ param: { id, imageId } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async groups(divisionId: string) {
      const res = await client.groups.$get({ query: { divisionId } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async createGroup(json: z.infer<typeof groupInput>) {
      const res = await client.groups.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async updateGroup(groupId: string, json: z.infer<typeof groupInput> & { version: number }) {
      const res = await client.groups[":groupId"].$put({ param: { groupId }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async removeGroup(groupId: string, version: number) {
      const res = await client.groups[":groupId"].$delete({
        param: { groupId },
        query: { version: String(version) },
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async placements(divisionId: string) {
      const res = await client.placements[":divisionId"].$get({ param: { divisionId } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async savePlacements(json: z.infer<typeof placementsInput>) {
      const res = await client.placements.$put({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async previewSchedule(json: RoundRobinInput) {
      const res = await client.schedule.preview.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async commitSchedule(json: RoundRobinInput) {
      const res = await client.schedule.commit.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type CompetitionMatchesApi = ReturnType<typeof createCompetitionMatchesApi>;

export const competitionMatchesApi = createCompetitionMatchesApi(ENV.VITE_SERVER_URL);
