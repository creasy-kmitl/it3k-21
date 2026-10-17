import { Files, FilesError } from "files-sdk";
import { r2 } from "files-sdk/r2";
import type {
  FixedLengthStream as WorkerFixedLengthStream,
  R2Bucket,
} from "@cloudflare/workers-types";

// Keep the native Worker stream contract when the web app checks API imports
// with DOM types, which omit Workers' BYOB reader extensions.
declare const FixedLengthStream: typeof WorkerFixedLengthStream;

export type FileStore = {
  createUpload: (key: string, contentType: string) => Promise<string>;
  abortUpload: (key: string, uploadId: string) => Promise<void>;
  upload: (
    key: string,
    body: ReadableStream<Uint8Array>,
    size: number,
    uploadId: string,
  ) => Promise<void>;
  delete: (key: string) => Promise<void>;
  download: (
    key: string,
  ) => Promise<{ body: ReadableStream<Uint8Array>; size: number; etag: string } | null>;
};

/** Construct per request: streams and binding I/O belong to that request. */
export function createFileStore(binding: R2Bucket): FileStore {
  const files = new Files({ adapter: r2({ binding }) });
  return {
    async createUpload(key, contentType) {
      const upload = await binding.createMultipartUpload(key, { httpMetadata: { contentType } });
      return upload.uploadId;
    },
    async abortUpload(key, uploadId) {
      try {
        await binding.resumeMultipartUpload(key, uploadId).abort();
      } catch (error) {
        // Completed/aborted uploads cannot publish again. Other failures must
        // retain the reservation so cleanup can retry without freeing quota.
        if (error instanceof Error && /\(10024\)/.test(error.message)) return;
        throw error;
      }
    },
    async upload(key, body, size, uploadId) {
      const upload = binding.resumeMultipartUpload(key, uploadId);
      const fixed = new FixedLengthStream(size);
      const abort = new AbortController();
      const copying = body.pipeTo(fixed.writable, { signal: abort.signal });
      const part = upload.uploadPart(1, fixed.readable);
      try {
        const [, uploaded] = await Promise.all([copying, part]);
        await upload.complete([uploaded]);
      } finally {
        abort.abort();
        // Compensation may delete metadata only after both sides have settled.
        await Promise.allSettled([copying, part]);
      }
    },
    async delete(key) {
      await files.delete(key);
    },
    async download(key) {
      try {
        const file = await files.download(key, { as: "stream" });
        return { body: file.stream(), size: file.size, etag: file.etag ?? "" };
      } catch (error) {
        if (error instanceof FilesError && error.code === "NotFound") return null;
        throw error;
      }
    },
  };
}
