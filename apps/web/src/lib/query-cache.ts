import type { QueryClient } from "@tanstack/react-query";

const owners = new WeakMap<QueryClient, string | null>();

/**
 * Cached queries (roster pages, `canEdit`/`canDelete` flags) belong to the
 * account that fetched them. Call before rendering authenticated pages: when
 * the signed-in user differs from the one the cache was filled for, drop it
 * all so the next account never sees the previous one's data, even briefly.
 */
export function clearCacheOnUserChange(client: QueryClient, userId: string | null) {
  if (owners.has(client) && owners.get(client) !== userId) {
    client.clear();
  }
  owners.set(client, userId);
}
