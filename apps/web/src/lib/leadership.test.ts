import { describe, expect, test } from "bun:test";

import { defined } from "@/test/query";

import { ApiError, createLeadershipApi } from "./leadership";

type Call = { url: string; method: string; body: string | null; credentials?: RequestCredentials };

function stub(status: number, body?: unknown) {
  const calls: Call[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push({
      url: request.url,
      method: request.method,
      body: request.method === "GET" ? null : await request.text(),
      credentials: init?.credentials,
    });
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? {} : { "content-type": "application/json" },
    });
  };
  return { calls, api: createLeadershipApi("https://api.test", fetch) };
}

const summary = {
  id: "7f1c0e7e-3a0b-4c55-9f5d-2a4f7a3b9c10",
  departmentId: "d1",
  departmentName: "Art",
  role: "head",
  userId: null,
  name: "A",
  nickname: null,
  displayName: "A",
  canEdit: false,
  canDelete: false,
};

describe("leadership client", () => {
  test("lists with typed query parameters and sends credentials", async () => {
    const { calls, api } = stub(200, {
      items: [summary],
      page: 2,
      hasMore: false,
      canCreate: false,
    });
    const page = await api.list({ q: "ชาย", page: 2 });
    expect(page.items[0]?.displayName).toBe("A");
    expect(calls).toHaveLength(1);
    const url = new URL(defined(calls[0], "request").url);
    expect(url.pathname).toBe("/api/leadership");
    expect(url.searchParams.get("q")).toBe("ชาย");
    expect(url.searchParams.get("page")).toBe("2");
    expect(calls[0]?.credentials).toBe("include");
  });

  test("omits empty filters from the query string", async () => {
    const { calls, api } = stub(200, { items: [], page: 1, hasMore: false, canCreate: false });
    await api.list({ q: "", departmentId: undefined, page: 1 });
    expect(new URL(defined(calls[0], "request").url).search).toBe("?page=1");
  });

  test("reveal posts the confirmation", async () => {
    const { calls, api } = stub(200, { phone: "081", socials: [] });
    expect(await api.reveal(summary.id)).toEqual({ phone: "081", socials: [] });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: `https://api.test/api/leadership/${summary.id}/reveal`,
      body: JSON.stringify({ confirmed: true }),
    });
  });

  test("delete resolves on 204 without reading a body", async () => {
    const { calls, api } = stub(204);
    expect(await api.remove(summary.id)).toBeUndefined();
    expect(calls[0]?.method).toBe("DELETE");
  });

  for (const status of [400, 401, 403, 404, 409, 503]) {
    test(`${status} becomes an ApiError with the server's message`, async () => {
      const { api } = stub(status, { message: `server said ${status}` });
      const error = await api.get(summary.id).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status, message: `server said ${status}` });
    });
  }

  test("a non-JSON error body still yields a readable message", async () => {
    const fetch = async () => new Response("<html>bad gateway</html>", { status: 502 });
    const api = createLeadershipApi("https://api.test", fetch);
    const error = await api.departments().catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, message: expect.stringContaining("502") });
  });
});
