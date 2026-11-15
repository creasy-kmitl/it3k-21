import { hc } from "hono/client";
import type { ClientRequestOptions, InferRequestType, InferResponseType } from "hono/client";

import type { ViewAsRoutes } from "../../../server/src/routes/view-as";
import { ENV } from "../env.public";

import { toApiError } from "./leadership";

type Client = ReturnType<typeof hc<ViewAsRoutes>>;

export type ViewAsState = InferResponseType<Client["index"]["$get"], 200>;
export type ActiveView = Extract<ViewAsState, { active: true }>;
export type ViewAsRequest = InferRequestType<Client["index"]["$post"]>["json"];
export type ViewAsKind = ViewAsRequest["kind"];

export function createViewAsApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<ViewAsRoutes>(`${baseUrl}/api/view-as`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async get() {
      const res = await client.index.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async start(json: ViewAsRequest) {
      const res = await client.index.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async stop() {
      const res = await client.index.$delete();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type ViewAsApi = ReturnType<typeof createViewAsApi>;

export const viewAsApi = createViewAsApi(ENV.VITE_SERVER_URL);

let loaded: Promise<ViewAsState> | null = null;

/**
 * The view this page load runs under, asked of the server once. Starting or
 * ending a view (or an impersonation) reloads the whole page, which is what
 * clears this along with the query cache and every route's context.
 */
export function loadViewAs(api: ViewAsApi = viewAsApi): Promise<ViewAsState> {
  loaded ??= api.get().catch((): ViewAsState => ({ active: false }));
  return loaded;
}

/** Forgets the loaded view; for tests. */
export function resetViewAs() {
  loaded = null;
}

/**
 * The session's user as the view shows them, so pages that gate on the role
 * (staff redirect, sidebar, department editing) render what that role sees.
 * Only the UI is affected: the API applies the view itself, from its cookie.
 */
export function viewedUser<
  T extends { role?: string | null; departmentId?: string | null; institution?: string | null },
>(user: T, view: ActiveView): T {
  const seat = view.kind === "head" || view.kind === "vicehead";
  return {
    ...user,
    role: seat ? "staff" : view.kind,
    departmentId: view.department?.id ?? null,
    institution: view.institution,
  };
}

/** A full page load, so nothing cached for the previous identity survives. */
export function reloadAt(path: string) {
  window.location.assign(path);
}
