import { afterEach, describe, expect, mock, test } from "bun:test";
import type { RoundRobinInput } from "@it3k/db/competition-rules";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import { DEC_1_0900, division, setup } from "@/components/competition/match-test-fixtures";
import { ApiProvider } from "@/lib/api-context";
import type { CompetitionDivisionsApi } from "@/lib/competition-divisions";
import type { CompetitionMatchesApi, SchedulePlan } from "@/lib/competition-matches";
import { choose, fakeApis, fakeVenuesApi, loudFake } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { GeneratePage, shuffleIntoGroups } from "./matches_.generate";

afterEach(cleanup);

const plan = (input: RoundRobinInput): SchedulePlan => ({
  divisionId: input.divisionId,
  stageName: input.stageName,
  friendly: false,
  firstMatchNo: 1,
  slots: 1,
  endsAt: DEC_1_0900 + 3_600_000,
  groups: [],
  matches: [
    {
      roundNo: 1,
      homeTeamId: "team-kmitl",
      awayTeamId: "team-kmutt",
      groupIndex: 0,
      groupName: "A",
      matchNo: 1,
      slot: 0,
      startAt: DEC_1_0900,
      venueId: "v-1",
      court: "1",
      homeName: "สจล.",
      awayName: "มจธ.",
      venueName: "สนามกลาง",
    },
  ],
});

async function render(overrides: Partial<CompetitionMatchesApi> = {}) {
  const previewSchedule = mock(async (input: RoundRobinInput) => ({ plan: plan(input) }));
  const commitSchedule = mock(async (input: RoundRobinInput) => ({
    groupIds: ["g-1"],
    matchIds: ["m-1"],
    plan: plan(input),
  }));
  const onDone = mock(() => {});
  const api = loudFake<CompetitionMatchesApi>("competitionMatches", {
    setup: async () => setup(),
    previewSchedule: previewSchedule as unknown as CompetitionMatchesApi["previewSchedule"],
    commitSchedule: commitSchedule as unknown as CompetitionMatchesApi["commitSchedule"],
    ...overrides,
  });
  const apis = fakeApis({
    competitionMatches: api,
    competitionDivisions: loudFake<CompetitionDivisionsApi>("competitionDivisions", {
      list: async () => ({ items: [division()], canManage: true }) as never,
    }),
    venues: fakeVenuesApi({
      list: async () => ({ items: [{ id: "v-1", name: "สนามกลาง" }], canManage: false }) as never,
    }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // A fixed "random" order keeps the shuffle predictable.
  const view = await renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={apis}>
        <GeneratePage onDone={onDone} random={() => 0} />
      </ApiProvider>
    </QueryClientProvider>
  ));
  return { view, previewSchedule, commitSchedule, onDone };
}

describe("shuffleIntoGroups", () => {
  test("spreads teams evenly over the groups", () => {
    const groups = shuffleIntoGroups(["a", "b", "c", "d", "e"], 2, () => 0.5);
    const sizes = [0, 1].map((g) => Object.values(groups).filter((v) => v === g).length);
    expect(sizes.toSorted()).toEqual([2, 3]);
    expect(Object.keys(groups).toSorted()).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("/staff/matches/generate", () => {
  test("previews the round robin before confirming, then saves it", async () => {
    const { view, previewSchedule, commitSchedule, onDone } = await render();
    await choose(await view.findByRole("combobox", { name: "ประเภท" }), "ฟุตบอล · ฟุตบอลชาย");
    await choose(await view.findByRole("combobox", { name: "จำนวนสาย" }), "2 สาย");
    fireEvent.click(view.getByRole("button", { name: /สุ่มสาย/ }));
    await choose(view.getByRole("combobox", { name: "สถานที่ของสนามที่ 1" }), "สนามกลาง");

    const confirm = view.getByRole("button", { name: /ยืนยันสร้างตาราง/ });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByRole("button", { name: /ดูตัวอย่าง/ }));
    await waitFor(() => expect(previewSchedule).toHaveBeenCalledTimes(1));
    const body = previewSchedule.mock.calls[0]?.[0] as RoundRobinInput;
    expect(body.groups.map((g) => g.teamIds.length)).toEqual([2, 2]);
    expect(body).toMatchObject({
      divisionId: "d-football",
      stageName: "รอบแบ่งกลุ่ม",
      slotMinutes: 60,
      legs: 1,
      courts: [{ venueId: "v-1", court: "1" }],
    });

    const table = await view.findByRole("region", { name: /^เวลา / });
    expect(within(table).getByText("สจล.")).toBeTruthy();
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() => expect(commitSchedule).toHaveBeenCalledWith(body));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  test("a change after the preview asks for a fresh one", async () => {
    const { view } = await render();
    await choose(await view.findByRole("combobox", { name: "ประเภท" }), "ฟุตบอล · ฟุตบอลชาย");
    fireEvent.click(await view.findByRole("button", { name: /ดูตัวอย่าง/ }));
    await view.findByRole("region", { name: /^เวลา / });
    fireEvent.click(view.getByRole("button", { name: "เหย้า-เยือน" }));
    expect(await view.findByText(/มีการแก้ไขหลังดูตัวอย่าง/)).toBeTruthy();
    expect(
      (view.getByRole("button", { name: /ยืนยันสร้างตาราง/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("a group with one team cannot be previewed", async () => {
    const { view, previewSchedule } = await render();
    await choose(await view.findByRole("combobox", { name: "ประเภท" }), "ฟุตบอล · ฟุตบอลชาย");
    await choose(await view.findByRole("combobox", { name: "จำนวนสาย" }), "4 สาย");
    fireEvent.click(view.getByRole("button", { name: /สุ่มสาย/ }));
    fireEvent.click(view.getByRole("button", { name: /ดูตัวอย่าง/ }));
    expect(await view.findByText("ทุกสายต้องมีอย่างน้อย 2 ทีม")).toBeTruthy();
    expect(previewSchedule).not.toHaveBeenCalled();
  });

  test("building by hand opens the match form for the chosen division", async () => {
    const { view } = await render({
      list: async () => ({ items: [], canManage: true, canScore: true }) as never,
    });
    fireEvent.click(view.getByRole("button", { name: "สร้างเอง" }));
    await choose(await view.findByRole("combobox", { name: "ประเภท" }), "ฟุตบอล · ฟุตบอลชาย");
    fireEvent.click(await view.findByRole("button", { name: /สร้างแมตช์/ }));
    expect(await view.findByRole("dialog", { name: "สร้างแมตช์" })).toBeTruthy();
  });
});
