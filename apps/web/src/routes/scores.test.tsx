import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from "@tanstack/react-router";

import { PublicMatchPage } from "@/components/scores/public-match-page";
import { ApiProvider } from "@/lib/api-context";
import type { Scoreboard } from "@/lib/matches";
import { fakeApis, fakePublicScoresApi, match } from "@/test/query";

import { ScoreboardPage } from "./scores";

afterEach(cleanup);

function MatchRoute() {
  const { matchId } = useParams({ strict: false });
  return <PublicMatchPage matchId={matchId ?? ""} />;
}

/** The public scores pages in a memory router at their real paths, so the card link works. */
async function setup(matches: Scoreboard["matches"], path = "/scores") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: Outlet });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/scores", component: ScoreboardPage }),
      createRoute({ getParentRoute: () => root, path: "/scores/$matchId", component: MatchRoute }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await act(() => router.load());
  const publicScores = fakePublicScoresApi({
    get: async () => ({ matches, standings: { overall: [], bySport: [] } }),
  });
  return render(
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ publicScores })}>
        <RouterProvider router={router} />
      </ApiProvider>
    </QueryClientProvider>,
  );
}

const { version: _version, updatedBy: _updatedBy, ...live } = match({
  id: "m1",
  sport: "บาสเก็ตบอล",
  teamA: "kmitl",
  teamB: "kmutnb",
  scoreA: 9,
  scoreB: 12,
  status: "live",
});

describe("public scores", () => {
  test("a match card opens that match's score page", async () => {
    await setup([live]);
    fireEvent.click(await screen.findByRole("link", { name: /ดูคะแนน บาสเก็ตบอล สจล\. พบ มจพ\./ }));
    expect(await screen.findByRole("heading", { name: "บาสเก็ตบอล" })).toBeDefined();
    expect(screen.getByLabelText("คะแนน สจล.").textContent).toBe("9");
    expect(screen.getByLabelText("คะแนน มจพ.").textContent).toBe("12");
  });

  test("the score page only shows scores: nothing to press except the way back", async () => {
    await setup([live], "/scores/m1");
    expect(await screen.findByText("กำลังแข่ง")).toBeDefined();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "กลับไปหน้าคะแนน",
    ]);
  });

  test("an emergency stop reads as paused, an unknown match as missing", async () => {
    await setup([{ ...live, pausedAt: 1 }], "/scores/m1");
    expect(await screen.findByText("หยุดชั่วคราว")).toBeDefined();
    cleanup();
    await setup([live], "/scores/other");
    expect(await screen.findByText("ไม่พบแมตช์นี้ อาจถูกลบไปแล้ว")).toBeDefined();
  });
});
