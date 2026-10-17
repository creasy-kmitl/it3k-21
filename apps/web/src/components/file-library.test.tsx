import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiProvider } from "@/lib/api-context";
import { fakeApis } from "@/test/query";
import { GiB } from "@it3k/db/profile";
import { FileLibrary } from "./file-library";

afterEach(cleanup);
test("a lost reservation can be cancelled from the library without waiting for expiry", async () => {
  let cancelled = false;
  const id = crypto.randomUUID();
  const apis = fakeApis({
    files: {
      list: async () => ({
        items: [],
        uploads: cancelled ? [] : [{ id, name: "lost.bin", size: 1, state: "pending" as const }],
        used: cancelled ? 0 : 1,
        limit: GiB,
        page: 1,
        hasMore: false,
      }),
      remove: async (fileId, userId) => {
        expect(userId).toBe("guest");
        expect(fileId).toBe(id);
        cancelled = true;
        return { success: true };
      },
      upload: async () => {
        throw new Error("Unexpected upload");
      },
    },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ApiProvider value={apis}>
        <FileLibrary userId="guest" onClose={() => {}} />
      </ApiProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "ยกเลิก lost.bin" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "ยกเลิก lost.bin" })).toBeNull());
  expect(cancelled).toBe(true);
});
