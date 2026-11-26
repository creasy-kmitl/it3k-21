import { afterEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import {
  DEC_1_0900,
  DEC_2_1300,
  division,
  listItem,
  side,
} from "@/components/competition/match-test-fixtures";
import { ApiProvider } from "@/lib/api-context";
import type { CompetitionDivisionsApi } from "@/lib/competition-divisions";
import type { CompetitionMatchesApi, MatchFilters, MatchListItem } from "@/lib/competition-matches";
import { choose, fakeApis, fakeVenuesApi, loudFake } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { MatchesPage, groupByDay } from "./matches";

afterEach(cleanup);

async function setup(items: MatchListItem[], canManage: boolean) {
  const list = mock(async (_filters?: MatchFilters) => ({ items, canManage, canScore: true }));
  const apis = fakeApis({
    competitionMatches: loudFake<CompetitionMatchesApi>("competitionMatches", {
      list: list as unknown as CompetitionMatchesApi["list"],
    }),
    competitionDivisions: loudFake<CompetitionDivisionsApi>("competitionDivisions", {
      list: async () =>
        ({
          items: [division(), division({ id: "d-futsal", name: "ฟุตซอลหญิง" })],
          canManage,
        }) as never,
    }),
    venues: fakeVenuesApi({ list: async () => ({ items: [], canManage: false }) }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={apis}>
        <MatchesPage onCreated={() => {}} />
      </ApiProvider>
    </QueryClientProvider>
  ));
  return { view, list };
}

describe("groupByDay", () => {
  test("groups by Bangkok day and puts matches without a time last", () => {
    const days = groupByDay([
      listItem({ id: "a", startAt: DEC_1_0900 }),
      listItem({ id: "b", startAt: DEC_1_0900 + 3_600_000 }),
      listItem({ id: "c", startAt: DEC_2_1300 }),
      listItem({ id: "d", startAt: null }),
    ]);
    expect(days.map((day) => day.matches.map((m) => m.id))).toEqual([["a", "b"], ["c"], ["d"]]);
    expect(days[2]?.label).toBe("ยังไม่กำหนดเวลา");
  });
});

describe("/staff/matches", () => {
  test("lists matches by day with their sides, placeholders and status", async () => {
    const { view } = await setup(
      [
        listItem(),
        listItem({
          id: "m-2",
          matchNo: 2,
          startAt: DEC_2_1300,
          participants: [side(), side({ id: "p-3", slot: 2, teamId: null, name: "ผู้ชนะ M1" })],
        }),
      ],
      false,
    );
    const first = await view.findByRole("region", { name: /1 ธันวาคม/ });
    expect(within(first).getByText("มจธ.")).toBeTruthy();
    expect(within(first).getByText("ยังไม่เริ่ม")).toBeTruthy();
    expect(view.getByText("ผู้ชนะ M1")).toBeTruthy();
    expect(view.queryByRole("button", { name: /สร้างแมตช์/ })).toBeNull();
  });

  test("managers get the create button; filtering by division asks the API again", async () => {
    const { view, list } = await setup([listItem()], true);
    expect(await view.findByRole("button", { name: /สร้างแมตช์/ })).toBeTruthy();
    expect(view.queryByRole("button", { name: /จัดตาราง/ })).toBeNull();
    await choose(view.getByRole("combobox", { name: "ประเภท" }), "ฟุตบอล · ฟุตซอลหญิง");
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ divisionId: "d-futsal" }));
  });

  test("an empty list says so", async () => {
    const { view } = await setup([], true);
    expect(await view.findByText("ยังไม่มีแมตช์")).toBeTruthy();
  });

  test("the create form opens for managers", async () => {
    const { view } = await setup([], true);
    fireEvent.click(await view.findByRole("button", { name: /สร้างแมตช์/ }));
    expect(await view.findByRole("dialog", { name: "สร้างแมตช์" })).toBeTruthy();
  });
});
