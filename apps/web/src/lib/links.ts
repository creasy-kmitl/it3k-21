import { hc } from "hono/client";
import type { ClientRequestOptions, InferRequestType, InferResponseType } from "hono/client";

import type { StatsRange } from "@it3k/db/short-link-rules";

import type { LinkErrorCode, LinkErrorField, LinkRoutes } from "../../../server/src/routes/links";
import { ENV } from "../env.public";
import { ApiError, toApiError } from "./leadership";

type Client = ReturnType<typeof hc<LinkRoutes>>;
type One = Client[":id"];

export type LinksPage = InferResponseType<Client["index"]["$get"], 200>;
export type ShortLink = LinksPage["items"][number];
export type ShortLinkDetail = InferResponseType<One["$get"], 200>;
export type ShortLinkChange = ShortLinkDetail["changes"][number];
export type ShortLinkInput = InferRequestType<Client["index"]["$post"]>["json"];
export type ShortLinkUpdate = InferRequestType<One["$patch"]>["json"];
export type LinkState = ShortLink["state"];

export type LinksQuery = { q?: string; mine?: boolean; tag?: string };

/** Why a link was refused, in Thai; the web form checks the same rules first. */
export const LINK_ERROR_MESSAGES: Record<LinkErrorCode, string> = {
  "slug-taken": "ชื่อลิงก์นี้มีคนใช้แล้ว ลองชื่ออื่น",
  "not-url": "ปลายทางต้องเป็น URL เต็ม เช่น https://example.com",
  "not-https": "ปลายทางต้องขึ้นต้นด้วย https:// เพื่อความปลอดภัยของผู้สแกน",
  credentials: "ปลายทางห้ามมีชื่อผู้ใช้หรือรหัสผ่านอยู่ใน URL",
  loop: "ปลายทางเป็นลิงก์สั้นอีกอัน ซึ่งจะวนไม่จบ",
  "expiry-past": "วันหมดอายุต้องอยู่ในอนาคต ถ้าจะหยุดลิงก์ตอนนี้ให้ปิดลิงก์แทน",
};

export type { LinkErrorField };

/** The API's reason for refusing a link, in Thai, and the field it is about. */
export function linkError(error: unknown): { field: LinkErrorField; message: string } | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body as { code?: unknown; field?: unknown } | null;
  const message = LINK_ERROR_MESSAGES[body?.code as LinkErrorCode];
  if (!message || typeof body?.field !== "string") return null;
  return { field: body.field as LinkErrorField, message };
}

export function createLinksApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<LinkRoutes>(`${baseUrl}/api/links`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async list(params: LinksQuery = {}) {
      const q = params.q?.trim();
      const res = await client.index.$get({
        query: {
          ...(q ? { q } : {}),
          ...(params.mine ? { mine: "1" as const } : {}),
          ...(params.tag ? { tag: params.tag } : {}),
        },
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async get(id: string, days?: StatsRange) {
      const res = await client[":id"].$get({
        param: { id },
        query: days ? { days: String(days) } : {},
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async create(json: ShortLinkInput) {
      const res = await client.index.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async update(id: string, json: ShortLinkUpdate) {
      const res = await client[":id"].$patch({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
  };
}

export type LinksApi = ReturnType<typeof createLinksApi>;

export const linksApi = createLinksApi(ENV.VITE_SERVER_URL);
