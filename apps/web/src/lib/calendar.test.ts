import { describe, expect, test } from "bun:test";

import { defined } from "@/test/query";

import { createCalendarApi } from "./calendar";
import { ApiError } from "./leadership";

type Call = { url: string; method: string; body: string | null; credentials?: RequestCredentials };

function stub(status: number, body: unknown = { ok: true }) {
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      method: request.method,
      body: request.method === "GET" || request.method === "DELETE" ? null : await request.text(),
      credentials: init?.credentials,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, api: createCalendarApi("https://api.test", fetch) };
}

describe("calendar client", () => {
  test("sends only the filters that were asked for, with the session cookie", async () => {
    const { calls, api } = stub(200, { items: [] });
    await api.list({ from: 1, to: 2 });
    await api.list({
      from: 1,
      to: 2,
      departmentIds: ["d-art", "d-pr"],
      statuses: ["draft", "confirmed"],
      ownerId: "u1",
      q: "  ฉาก ",
    });
    await api.list({ from: 1, to: 2, departmentIds: [], q: "   " });
    const [plain, filtered, blank] = calls.map((call) => new URL(call.url));
    expect(Object.fromEntries(defined(plain).searchParams)).toEqual({ from: "1", to: "2" });
    expect(Object.fromEntries(defined(filtered).searchParams)).toEqual({
      from: "1",
      to: "2",
      departmentIds: "d-art,d-pr",
      status: "draft,confirmed",
      ownerId: "u1",
      q: "ฉาก",
    });
    expect(Object.fromEntries(defined(blank).searchParams)).toEqual({ from: "1", to: "2" });
    expect(calls[0]?.credentials).toBe("include");
    expect(defined(plain).pathname).toBe("/api/calendar/items");
  });

  test("deletes with the version it read", async () => {
    const { calls, api } = stub(200);
    await api.remove("item-1", 4);
    expect(calls[0]).toMatchObject({
      method: "DELETE",
      url: "https://api.test/api/calendar/items/item-1?version=4",
    });
  });

  test("marks all or some notifications read", async () => {
    const { calls, api } = stub(200);
    await api.markRead("all");
    await api.markRead(["n1"]);
    expect(calls.map((call) => JSON.parse(call.body ?? "null"))).toEqual([
      { all: true },
      { ids: ["n1"] },
    ]);
  });

  test("turns a refused save into an ApiError with the server's message", async () => {
    const { api } = stub(409, { message: "This item changed while you were editing" });
    const error = await api.update("item-1", { title: "x", version: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      message: "This item changed while you were editing",
    });
  });
});
