import { hc, type ClientRequestOptions, type InferResponseType } from "hono/client";
import type { FileRoutes } from "../../../server/src/routes/files";
import { ENV } from "../env.public";
import { toApiError } from "./leadership";

type Client = ReturnType<typeof hc<FileRoutes>>;
export type FilePage = InferResponseType<Client["index"]["$get"], 200>;
export type LibraryFile = FilePage["items"][number];
export function publicFileUrl(id: string) {
  return `${ENV.VITE_SERVER_URL}/api/files/public/${encodeURIComponent(id)}`;
}
export function fileSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
export function createFilesApi(baseUrl: string, fetchImpl?: ClientRequestOptions["fetch"]) {
  const client = hc<FileRoutes>(`${baseUrl}/api/files`, {
    fetch: fetchImpl,
    init: { credentials: "include" },
  });
  return {
    async list(params: { q?: string; images?: boolean; page?: number } = {}) {
      const res = await client.index.$get({
        query: {
          page: String(params.page ?? 1),
          ...(params.q ? { q: params.q } : {}),
          ...(params.images ? { images: "true" } : {}),
        },
      });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async remove(id: string) {
      const res = await client[":id"].$delete({ param: { id } });
      if (!res.ok) throw await toApiError(res);
      return res.json();
    },
    async upload(
      file: File,
      options: { signal: AbortSignal; onProgress: (value: number) => void },
    ) {
      if (options.signal.aborted) throw new DOMException("Upload cancelled", "AbortError");
      // Known before the request: compensation also works if its response is lost.
      const requestId = crypto.randomUUID();
      try {
        const reservation = await client.uploads.$post({
          json: {
            requestId,
            name: file.name,
            size: file.size,
            contentType: file.type || "application/octet-stream",
          },
        });
        if (!reservation.ok) throw await toApiError(reservation);
        const { id } = await reservation.json();
        const response = await new Promise<Response>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const abort = () => {
            xhr.abort();
            reject(new DOMException("Upload cancelled", "AbortError"));
          };
          if (options.signal.aborted) {
            abort();
            return;
          }
          xhr.open("PUT", `${baseUrl}/api/files/${id}/content`);
          xhr.withCredentials = true;
          xhr.setRequestHeader("Content-Type", "application/octet-stream");
          options.signal.addEventListener("abort", abort, { once: true });
          xhr.upload.onprogress = (event) =>
            options.onProgress(event.lengthComputable ? (event.loaded / event.total) * 100 : 0);
          xhr.onload = () => resolve(new Response(xhr.responseText, { status: xhr.status }));
          xhr.onerror = () => reject(new Error("เชื่อมต่อระบบอัปโหลดไม่สำเร็จ"));
          xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
          xhr.onloadend = () => options.signal.removeEventListener("abort", abort);
          xhr.send(file);
        });
        if (!response.ok) throw await toApiError(response);
        options.onProgress(100);
        return { id };
      } catch (error) {
        // Cancellation fences running writers too. If this request cannot
        // reach the API, the owner can cancel the reservation in the library.
        await client.uploads[":requestId"].$delete({ param: { requestId } }).catch(() => undefined);
        throw error;
      }
    },
  };
}
export type FilesApi = ReturnType<typeof createFilesApi>;
export const filesApi = createFilesApi(ENV.VITE_SERVER_URL);
