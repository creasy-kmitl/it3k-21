import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { clearCacheOnUserChange } from "./query-cache";

const seed = (client: QueryClient) => client.setQueryData(["leadership", "list"], { items: [1] });

describe("clearCacheOnUserChange", () => {
  test("keeps the cache while the same user stays signed in", () => {
    const client = new QueryClient();
    clearCacheOnUserChange(client, "a");
    seed(client);
    clearCacheOnUserChange(client, "a");
    expect(client.getQueryData(["leadership", "list"])).toBeDefined();
  });

  test("drops everything when another user signs in or the user signs out", () => {
    const client = new QueryClient();
    clearCacheOnUserChange(client, "a");
    seed(client);
    clearCacheOnUserChange(client, "b");
    expect(client.getQueryData(["leadership", "list"])).toBeUndefined();
    seed(client);
    clearCacheOnUserChange(client, null);
    expect(client.getQueryData(["leadership", "list"])).toBeUndefined();
  });

  test("tracks each client separately", () => {
    const first = new QueryClient();
    const second = new QueryClient();
    clearCacheOnUserChange(first, "a");
    clearCacheOnUserChange(second, "b");
    seed(first);
    clearCacheOnUserChange(first, "a");
    expect(first.getQueryData(["leadership", "list"])).toBeDefined();
  });
});
