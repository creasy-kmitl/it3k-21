import { afterEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import {
  DEC_1_0900,
  DEC_2_1300,
  detail,
  division,
  listItem,
  setup as matchSetup,
  side,
} from "@/components/competition/match-test-fixtures";
import { ApiProvider } from "@/lib/api-context";
import type { CompetitionDivisionsApi } from "@/lib/competition-divisions";
import type { CompetitionMatchesApi, MatchFilters, MatchListItem } from "@/lib/competition-matches";
import { choose, fakeApis, fakeVenuesApi, loudFake } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { MatchesPage, bracketPreset, groupByDay } from "./matches";

afterEach(cleanup);

async function setup(items: MatchListItem[], canManage: boolean) {
  const list = mock(async (_filters?: MatchFilters) => ({ items, canManage, canScore: true }));
  const create = mock(async (_input: unknown) => ({ match: detail({ id: "m-new" }) }));
  const createBracket = mock(async (_input: unknown) => ({ matchIds: ["a", "b", "c", "d"] }));
  const apis = fakeApis({
    competitionMatches: loudFake<CompetitionMatchesApi>("competitionMatches", {
      list: list as unknown as CompetitionMatchesApi["list"],
      setup: async () => matchSetup(),
      create: create as unknown as CompetitionMatchesApi["create"],
      createBracket: createBracket as unknown as CompetitionMatchesApi["createBracket"],
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
  return { view, list, create, createBracket };
}

/** A semi-final whose winner goes to a final still waiting on its other side. */
const knockout = () => [
  listItem({ id: "m-sf", matchNo: 1, stageName: "รอบรองชนะเลิศ", version: 4 }),
  listItem({
    id: "m-final",
    matchNo: 2,
    stageName: "ชิงชนะเลิศ",
    version: 7,
    participants: [
      side({
        id: "p-f1",
        teamId: null,
        name: "ผู้ชนะ M1",
        institution: null,
        sourceMatchId: "m-sf",
        sourceResult: "winner",
      }),
      side({ id: "p-f2", slot: 2, teamId: null, name: "ผู้ชนะ M3", institution: null }),
    ],
  }),
];

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

  test("the bracket view draws knockout rounds and asks for whole divisions", async () => {
    const { view, list } = await setup(
      [
        listItem({ id: "m-sf", matchNo: 1, stageName: "รอบรองชนะเลิศ" }),
        listItem({
          id: "m-final",
          matchNo: 2,
          stageName: "ชิงชนะเลิศ",
          participants: [
            side({
              id: "p-f1",
              teamId: null,
              name: "ผู้ชนะ M1",
              institution: null,
              sourceMatchId: "m-sf",
              sourceResult: "winner",
            }),
            side({ id: "p-f2", slot: 2, teamId: null, name: "ผู้ชนะ M3", institution: null }),
          ],
        }),
      ],
      false,
    );
    await view.findAllByText("สจล.");
    fireEvent.click(view.getByRole("button", { name: /สายการแข่ง/ }));
    const bracket = await view.findByRole("region", { name: /ฟุตบอล · ฟุตบอลชาย/ });
    const cards = within(bracket).getAllByRole("link");
    expect(cards.map((card) => card.getAttribute("href"))).toEqual([
      "/staff/matches/m-sf",
      "/staff/matches/m-final",
    ]);
    expect(within(bracket).getByText("ผู้ชนะ M1")).toBeTruthy();
    expect(view.queryByRole("combobox", { name: "สถานที่" })).toBeNull();
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({}));
  });

  test("managers add the match before an open side; its winner is sent there", async () => {
    const { view, create } = await setup(knockout(), true);
    await view.findAllByText("สจล.");
    fireEvent.click(view.getByRole("button", { name: /สายการแข่ง/ }));
    expect(await view.findByRole("button", { name: "ต่อรอบถัดไปจาก M2 · ชิงชนะเลิศ" })).toBeTruthy();
    // The semi-final feeds the final, so it does not go on by itself.
    expect(view.queryByRole("button", { name: "ต่อรอบถัดไปจาก M1 · รอบรองชนะเลิศ" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "เพิ่มแมตช์ก่อนหน้าให้ฝั่ง 2 ของ M2 · ชิงชนะเลิศ" }));
    const dialog = await view.findByRole("dialog", { name: "สร้างแมตช์" });
    expect(within(dialog).getByText(/ผู้ชนะแมตช์นี้จะเข้าฝั่ง 2 ของ M2 · ชิงชนะเลิศ/)).toBeTruthy();
    await choose(within(dialog).getByRole("combobox", { name: "ทีมฝั่ง 1" }), "สจล.");
    await choose(within(dialog).getByRole("combobox", { name: "ทีมฝั่ง 2" }), "มจธ.");
    fireEvent.click(within(dialog).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      divisionId: "d-football",
      stageName: "รอบรองชนะเลิศ",
      feeds: { matchId: "m-final", slot: 2, version: 7 },
    });
  });

  test("staff who cannot manage matches see no add buttons", async () => {
    const { view } = await setup(knockout(), false);
    await view.findAllByText("สจล.");
    fireEvent.click(view.getByRole("button", { name: /สายการแข่ง/ }));
    await view.findByRole("region", { name: /ฟุตบอล · ฟุตบอลชาย/ });
    expect(view.queryByRole("button", { name: /ต่อรอบถัดไป|เพิ่มแมตช์ก่อนหน้า|เพิ่มสายการแข่ง/ })).toBeNull();
  });

  test("เพิ่มสายการแข่ง builds a whole bracket for the chosen division", async () => {
    const { view, createBracket } = await setup([], true);
    await view.findByText("ยังไม่มีแมตช์");
    fireEvent.click(view.getByRole("button", { name: /สายการแข่ง/ }));
    const [button] = await view.findAllByRole("button", { name: /เพิ่มสายการแข่ง/ });
    fireEvent.click(button as HTMLElement);
    const dialog = await view.findByRole("dialog", { name: "เพิ่มสายการแข่ง" });
    expect(within(dialog).getByText("จะสร้าง 4 แมตช์")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "8 ทีม" }));
    expect(within(dialog).getByText("จะสร้าง 8 แมตช์")).toBeTruthy();
    expect(within(dialog).getByText("รอบก่อนรองชนะเลิศ")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /สร้าง 8 แมตช์/ }));
    expect(
      await within(dialog).findByText("เลือกประเภท", { selector: "[data-slot=field-error]" }),
    ).toBeTruthy();
    await choose(within(dialog).getByRole("combobox", { name: "ประเภท" }), "ฟุตบอล · ฟุตบอลชาย");
    fireEvent.click(within(dialog).getByRole("button", { name: /สร้าง 8 แมตช์/ }));
    await waitFor(() =>
      expect(createBracket).toHaveBeenCalledWith({
        divisionId: "d-football",
        teams: 8,
        thirdPlace: true,
      }),
    );
  });

  test("the create form opens for managers", async () => {
    const { view } = await setup([], true);
    fireEvent.click(await view.findByRole("button", { name: /สร้างแมตช์/ }));
    expect(await view.findByRole("dialog", { name: "สร้างแมตช์" })).toBeTruthy();
  });
});

describe("bracketPreset", () => {
  const [semi, final] = knockout().map((item) => ({
    id: item.id,
    divisionId: item.divisionId,
    divisionName: item.divisionName,
    sportId: item.sportId,
    sportName: item.sportName,
    sportIcon: item.sportIcon,
    stageName: item.stageName,
    matchNo: item.matchNo,
    startAt: item.startAt,
    status: item.status,
    version: item.version,
    sides: [],
  }));

  test("the next round waits on this match's winner and takes the next round's name", () => {
    expect(bracketPreset({ kind: "next", match: semi as never })).toEqual({
      divisionId: "d-football",
      stageName: "ชิงชนะเลิศ",
      sides: [
        { teamId: null, label: "", source: { matchId: "m-sf", result: "winner" } },
        { teamId: null, label: "", source: null },
      ],
    });
  });

  test("a third-place match takes both feeders' losers", () => {
    expect(
      bracketPreset({ kind: "third", match: final as never, feeders: [semi, final] as never })
        .sides,
    ).toEqual([
      { teamId: null, label: "", source: { matchId: "m-sf", result: "loser" } },
      { teamId: null, label: "", source: { matchId: "m-final", result: "loser" } },
    ]);
  });
});
