import type { Institution } from "@it3k/db/profile";
import type { RegistrationFields, RegistrationStatus, ReviewInput } from "@it3k/db/sport-rules";
import { hc } from "hono/client";
import type { ClientRequestOptions, InferResponseType } from "hono/client";

import type { AthleteRoutes } from "../../../server/src/routes/athletes";
import { ENV } from "../env.public";

import { toApiError } from "./leadership";

type Client = ReturnType<typeof hc<AthleteRoutes>>;

export type AthletePage = InferResponseType<Client["index"]["$get"], 200>;
export type AthleteItem = AthletePage["items"][number];

export type AthleteFilters = {
  q?: string;
  sportId?: string;
  divisionId?: string;
  status?: RegistrationStatus;
  institution?: Institution;
};

export type AthleteEdit = RegistrationFields & {
  studentId: string;
  institution: Institution;
  version: number;
};

function query(filters: AthleteFilters) {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== ""),
  ) as Record<string, string>;
}

export function createAthletesApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<AthleteRoutes>(`${baseUrl}/api/athletes`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async list(filters: AthleteFilters & { page: number }) {
      const { page, ...rest } = filters;
      const res = await client.index.$get({ query: { ...query(rest), page: String(page) } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async exportAll(filters: AthleteFilters) {
      const res = await client.export.$get({ query: query(filters) });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async review(id: string, json: ReviewInput & { version: number }) {
      const res = await client[":id"].status.$put({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async edit(id: string, json: AthleteEdit) {
      const res = await client[":id"].$put({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type AthletesApi = ReturnType<typeof createAthletesApi>;

export const athletesApi = createAthletesApi(ENV.VITE_SERVER_URL);
