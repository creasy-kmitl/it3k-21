import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

test("searching waits for typing to pause and keeps the current files on screen meanwhile", async () => {
  const queries: string[] = [];
  let release: () => void = () => {};
  const file = (name: string) => ({
    id: name,
    name,
    size: 1,
    contentType: "application/pdf",
    url: `https://files.test/${name}`,
    createdAt: new Date(0).toISOString(),
  });
  const apis = fakeApis({
    files: {
      list: async ({ q }) => {
        queries.push(q ?? "");
        if (q) await new Promise<void>((resolve) => (release = resolve));
        return {
          items: [file(q ? "match.pdf" : "first.pdf")],
          uploads: [],
          used: 1,
          limit: GiB,
          page: 1,
          hasMore: false,
        };
      },
      remove: async () => ({ success: true }),
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
  expect(await screen.findByRole("button", { name: "first.pdf" })).toBeTruthy();
  expect(screen.getByText(/ใช้พื้นที่/)).toBeTruthy();

  const box = screen.getByRole("searchbox", { name: "ค้นหาไฟล์" });
  fireEvent.change(box, { target: { value: "m" } });
  fireEvent.change(box, { target: { value: "match" } });
  // While the search is on its way the old files stay, marked busy.
  expect(screen.getByRole("button", { name: "first.pdf" })).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "first.pdf" })
      .closest("[aria-busy]")
      ?.getAttribute("aria-busy"),
  ).toBe("true");
  await waitFor(() => expect(queries).toContain("match"));
  release();
  expect(await screen.findByRole("button", { name: "match.pdf" })).toBeTruthy();
  // One request for the pause, none for the half-typed "m".
  expect(queries).toEqual(["", "match"]);
});

test("deleting a file asks in a dialog first", async () => {
  const removed: string[] = [];
  const pdf = {
    id: "f-1",
    name: "poster.pdf",
    size: 1,
    contentType: "application/pdf",
    url: "https://files.test/poster.pdf",
    createdAt: new Date(0).toISOString(),
  };
  const apis = fakeApis({
    files: {
      list: async () => ({
        items: removed.length ? [] : [pdf],
        uploads: [],
        used: 1,
        limit: GiB,
        page: 1,
        hasMore: false,
      }),
      remove: async (fileId) => {
        removed.push(fileId);
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
  fireEvent.click(await screen.findByRole("button", { name: "poster.pdf" }));
  fireEvent.click(screen.getByRole("button", { name: "ลบไฟล์" }));
  // Cancelling keeps the file.
  fireEvent.click(
    await screen.findByRole("button", { name: "ยกเลิก" }, { container: document.body }),
  );
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(removed).toEqual([]);

  fireEvent.click(screen.getByRole("button", { name: "ลบไฟล์" }));
  const dialog = await screen.findByRole("alertdialog", { name: "ลบ poster.pdf?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "ลบ" }));
  await waitFor(() => expect(removed).toEqual(["f-1"]));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
});
