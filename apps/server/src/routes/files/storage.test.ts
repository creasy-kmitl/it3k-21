import { expect, test } from "bun:test";
import type { R2Bucket, R2ObjectBody } from "@cloudflare/workers-types";
import { defined } from "../../testing";
import { createFileStore } from "./storage";

function bucket(get: R2Bucket["get"], overrides: Partial<R2Bucket> = {}): R2Bucket {
  const unexpected = () => {
    throw new Error("Unexpected R2 operation");
  };
  return {
    get,
    head: unexpected,
    put: unexpected,
    createMultipartUpload: unexpected,
    resumeMultipartUpload: unexpected,
    delete: unexpected,
    list: unexpected,
    ...overrides,
  };
}

test("R2 downloads return the original body without buffering", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const body = defined(new Response(bytes).body);
  let buffered = false;
  const object: R2ObjectBody = {
    key: "file",
    size: bytes.length,
    version: "version",
    etag: "etag",
    httpEtag: '"etag"',
    uploaded: new Date(),
    checksums: { toJSON: () => ({}) },
    storageClass: "Standard",
    body,
    bodyUsed: false,
    arrayBuffer: async () => {
      buffered = true;
      return bytes.buffer;
    },
    bytes: async () => bytes,
    text: async () => "",
    json: async <T>() => ({}) as T,
    blob: async () => new Blob([bytes]),
    writeHttpMetadata: () => undefined,
  };
  const binding = bucket(async () => object);
  const file = defined(await createFileStore(binding).download("file"));
  expect(file.body).toBe(body);
  expect(new Uint8Array(await new Response(file.body).arrayBuffer())).toEqual(bytes);
  expect(buffered).toBe(false);
});

test("missing R2 objects return null", async () => {
  const binding = bucket(async () => null);
  expect(await createFileStore(binding).download("missing")).toBeNull();
});

test("multipart cancellation ignores only R2's missing-upload error", async () => {
  for (const message of [
    "abortMultipartUpload: The specified multipart upload does not exist. (10024)",
    "R2 unavailable (10001)",
  ]) {
    const binding = bucket(async () => null, {
      resumeMultipartUpload(key, uploadId) {
        return {
          key,
          uploadId,
          uploadPart: async () => {
            throw new Error("Unexpected upload");
          },
          complete: async () => {
            throw new Error("Unexpected completion");
          },
          abort: async () => {
            throw new Error(message);
          },
        };
      },
    });
    const cancelling = createFileStore(binding).abortUpload("file", "upload");
    if (message.includes("10024")) await expect(cancelling).resolves.toBeUndefined();
    else await expect(cancelling).rejects.toThrow(message);
  }
});
