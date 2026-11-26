import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, screen } from "@testing-library/react";

import { TV_PAGE_SIZE, tvPages } from "@/components/public/live-tv";
import { publicMatch } from "@/components/public/test-fixtures";
import { ApiProvider } from "@/lib/api-context";
import type { LiveBoard, PublicCompetitionApi } from "@/lib/public-competition";
import { fakeApis, loudFake } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { LiveView } from "./live";

afterEach(cleanup);

const live = publicMatch({
  id: "m-live",
  status: "live",
  live: { period: 2, phase: "regular", decided: false, clock: null },
  division: { id: "d-1", code: "football", name: "ฟุตบอลชาย" },
});
const next = publicMatch({ id: "m-next", division: { id: "d-2", code: "x", name: "แชร์บอล" } });

function setup(board: LiveBoard, tv: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const apis = fakeApis({
    publicCompetition: loudFake<PublicCompetitionApi>("publicCompetition", {
      live: async () => board,
    }),
  });
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={apis}>
        <LiveView tv={tv} />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

describe("live page", () => {
  test("lists live matches with their period, then what comes next", async () => {
    await setup({ now: Date.now(), live: [live], upcoming: [next], recent: [] }, false);
    expect(await screen.findByText("กำลังแข่ง 1 แมตช์")).toBeTruthy();
    expect(screen.getByText("ครึ่งที่ 2")).toBeTruthy();
    expect(screen.getByText("แมตช์ถัดไป")).toBeTruthy();
    expect(screen.getByText("โหมดจอทีวี").closest("a")?.getAttribute("href")).toBe("/live?tv=1");
  });

  test("with nothing live, it says so", async () => {
    await setup({ now: Date.now(), live: [], upcoming: [], recent: [] }, false);
    expect(await screen.findByText("ยังไม่มีแมตช์ที่กำลังแข่ง")).toBeTruthy();
  });

  test("TV mode is full screen, with no site navigation", async () => {
    await setup({ now: Date.now(), live: [live], upcoming: [next], recent: [] }, true);
    expect(await screen.findByText("ฟุตบอลชาย")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText("โหมดจอทีวี")).toBeNull();
  });

  test("TV pages hold four matches each", () => {
    const items = Array.from({ length: 9 }, (_, i) => i);
    expect(tvPages(items).map((page) => page.length)).toEqual([TV_PAGE_SIZE, TV_PAGE_SIZE, 1]);
    expect(tvPages([])).toEqual([]);
  });
});
