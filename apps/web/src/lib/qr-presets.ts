import type { PresetDesign } from "@it3k/db/qr-preset-rules";
import { hc } from "hono/client";
import type { ClientRequestOptions, InferRequestType, InferResponseType } from "hono/client";

import type { QrPresetRoutes } from "../../../server/src/routes/qr-presets";
import { ENV } from "../env.public";
import { toApiError } from "./leadership";
import type { ExportSize, QrDesign } from "./qr";

type Client = ReturnType<typeof hc<QrPresetRoutes>>;

export type QrPresetPage = InferResponseType<Client["index"]["$get"], 200>;
export type QrPreset = QrPresetPage["items"][number];
export type QrPresetInput = InferRequestType<Client["index"]["$post"]>["json"];
export type QrPresetUpdate = InferRequestType<Client[":id"]["$patch"]>["json"];

export function createQrPresetsApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<QrPresetRoutes>(`${baseUrl}/api/qr-presets`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });

  return {
    async list() {
      const res = await client.index.$get();
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async create(json: QrPresetInput) {
      const res = await client.index.$post({ json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async update(id: string, json: QrPresetUpdate) {
      const res = await client[":id"].$patch({ param: { id }, json });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },

    async remove(id: string) {
      const res = await client[":id"].$delete({ param: { id } });
      if (!res.ok) throw await toApiError(res);
    },
  };
}

export type QrPresetsApi = ReturnType<typeof createQrPresetsApi>;

export const qrPresetsApi = createQrPresetsApi(ENV.VITE_SERVER_URL);

/** QR Studio's design and export size, in the shape a preset stores. */
export function toPresetDesign(design: QrDesign, exportSize: ExportSize): PresetDesign {
  // Fixed key order, so two equal designs serialize alike (see samePresetDesign).
  return {
    dotStyle: design.dotStyle,
    markerBorder: design.markerBorder,
    markerCenter: design.markerCenter,
    dotColor: design.dotColor.toLowerCase(),
    markerColor: design.markerColor.toLowerCase(),
    background: design.background.toLowerCase(),
    logo: design.logo ? { dataUrl: design.logo.dataUrl, size: design.logo.size } : null,
    quietZone: design.quietZone,
    ecc: design.ecc,
    exportSize,
  };
}

/** A preset back as QR Studio's design and export size. */
export function fromPresetDesign(preset: PresetDesign): {
  design: QrDesign;
  exportSize: ExportSize;
} {
  const { exportSize, ...design } = preset;
  return { design, exportSize };
}

export function samePresetDesign(a: PresetDesign, b: PresetDesign) {
  const { design, exportSize } = fromPresetDesign(b);
  return (
    JSON.stringify(toPresetDesign(fromPresetDesign(a).design, a.exportSize)) ===
    JSON.stringify(toPresetDesign(design, exportSize))
  );
}
