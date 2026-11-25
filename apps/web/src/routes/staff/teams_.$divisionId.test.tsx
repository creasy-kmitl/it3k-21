import { afterEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type {
  CompetitionTeamsApi,
  DivisionTeamsPage as PageData,
  Team,
  TeamAthlete,
} from "@/lib/competition-teams";
import { fakeApis, loudFake } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { DivisionTeamsPage } from "./teams_.$divisionId";

afterEach(cleanup);

function athlete(id: string, overrides: Partial<TeamAthlete> = {}): TeamAthlete {
  return {
    registrationId: id,
    userId: `u-${id}`,
    institution: "kmutt",
    status: "approved",
    shirtNumber: null,
    badmintonRank: null,
    firstName: `ชื่อ${id}`,
    lastName: "นามสกุล",
    nickname: "",
    teamId: null,
    gender: "male",
    ...overrides,
  };
}

function team(
  id: string,
  seq: number,
  members: string[] = [],
  overrides: Partial<Team> = {},
): Team {
  return {
    id,
    divisionId: "d-1",
    institution: "kmutt",
    seq,
    name: null,
    label: `มจธ. ทีม ${seq}`,
    version: 1,
    createdAt: "2026-11-24T00:00:00.000Z",
    updatedAt: "2026-11-24T00:00:00.000Z",
    members: members.map((registrationId, sortOrder) => ({
      registrationId,
      userId: `u-${registrationId}`,
      displayName: `ชื่อ${registrationId}`,
      sortOrder,
      status: "approved",
      shirtNumber: null,
      badmintonRank: null,
      gender: "male",
    })),
    officials: [],
    issues: [],
    ...overrides,
  } as Team;
}

function page(overrides: Partial<PageData> = {}): PageData {
  return {
    division: {
      id: "d-1",
      code: "badminton-doubles-male",
      name: "แบดมินตัน คู่ชาย",
      gender: "male",
      format: "pair",
      requiresShirtNumber: false,
      requiresBadmintonRank: false,
      sportId: "s-1",
      sportName: "กีฬาแบดมินตัน",
      sportIcon: "badminton",
      maxTeamsPerInstitution: 2,
      teamMinSize: 2,
      teamMaxSize: 3,
      genderMinimums: null,
      maxOfficials: 1,
      lineupStarters: 2,
      lineupMaxSubs: 0,
    },
    teams: [team("t-1", 1, ["a"]), team("t-2", 2, ["c"])],
    athletes: [
      athlete("a", { teamId: "t-1" }),
      athlete("b"),
      athlete("c", { teamId: "t-2" }),
      athlete("d", { status: "review" }),
      athlete("e"),
    ],
    canManage: true,
    ...overrides,
  } as PageData;
}

async function setup(api: Partial<CompetitionTeamsApi>, teamId?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onSelect = mock((_next: { institution?: string; team?: string }) => undefined);
  const view = await renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ competitionTeams: loudFake("competitionTeams", api) })}>
        <DivisionTeamsPage divisionId="d-1" teamId={teamId} onSelect={onSelect} />
      </ApiProvider>
    </QueryClientProvider>
  ));
  return { ...view, onSelect };
}

describe("/staff/teams/$divisionId", () => {
  test("ticks athletes into a team, shows the count and live issues, and saves the list", async () => {
    const saveMembers = mock(async () => ({ team: team("t-1", 1, ["a", "b"]) }));
    const view = await setup({ division: async () => page(), saveMembers });

    expect(await view.findByText("เลือกแล้ว 1 / สูงสุด 3")).toBeTruthy();
    // One athlete is short of the pair's minimum.
    expect(view.getByText("นักกีฬา 1 คน ต้องมีอย่างน้อย 2 คน")).toBeTruthy();

    fireEvent.click(view.getByRole("checkbox", { name: /ชื่อb/ }));
    expect(view.getByText("เลือกแล้ว 2 / สูงสุด 3")).toBeTruthy();
    expect(view.getByText("ทีมครบตามเงื่อนไขแล้ว")).toBeTruthy();

    const bar = view.getByRole("region", { name: "บันทึกรายชื่อ" });
    fireEvent.click(within(bar).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(saveMembers).toHaveBeenCalledTimes(1));
    expect(saveMembers.mock.calls[0]).toEqual([
      "t-1",
      { registrationIds: ["a", "b"], version: 1 },
    ] as never);
  });

  test("athletes in another team or not approved cannot be ticked", async () => {
    const view = await setup({ division: async () => page() });
    const other = await view.findByRole("checkbox", { name: /ชื่อc/ });
    expect(
      other.getAttribute("aria-disabled") ?? other.getAttribute("data-disabled"),
    ).not.toBeNull();
    expect(view.getByText("อยู่ใน มจธ. ทีม 2")).toBeTruthy();
    const pending = view.getByRole("checkbox", { name: /ชื่อd/ });
    expect(
      pending.getAttribute("aria-disabled") ?? pending.getAttribute("data-disabled"),
    ).not.toBeNull();
    expect(view.getByText("รอตรวจสอบ")).toBeTruthy();
  });

  test("stops ticking at the team's maximum", async () => {
    const view = await setup({ division: async () => page() });
    fireEvent.click(await view.findByRole("checkbox", { name: /ชื่อb/ }));
    fireEvent.click(view.getByRole("checkbox", { name: /ชื่อe/ }));
    expect(view.getByText("เลือกแล้ว 3 / สูงสุด 3")).toBeTruthy();
    const unticked = view
      .getAllByRole("checkbox")
      .filter((box) => box.getAttribute("aria-checked") === "false");
    for (const box of unticked) {
      expect(box.getAttribute("aria-disabled") ?? box.getAttribute("data-disabled")).not.toBeNull();
    }
  });

  test("readers see teams without editing controls", async () => {
    const view = await setup({ division: async () => page({ canManage: false }) });
    expect(await view.findByRole("tab", { name: /มจธ. ทีม 1/ })).toBeTruthy();
    expect(view.queryByRole("button", { name: /เพิ่มทีม/ })).toBeNull();
    expect(view.queryByRole("button", { name: /ลบทีม/ })).toBeNull();
    expect(view.queryByRole("button", { name: /จัดอัตโนมัติ/ })).toBeNull();
  });

  test("an institution with no team offers to create one or deal athletes automatically", async () => {
    const create = mock(async () => ({ team: team("t-new", 1) }));
    const view = await setup({ division: async () => page({ teams: [] }), create });
    expect(await view.findByText("ยังไม่มีทีม")).toBeTruthy();
    expect(view.getByRole("button", { name: /จัดทีมอัตโนมัติ/ })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: /สร้างทีม/ }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]).toEqual([
      { divisionId: "d-1", institution: "kmutt", seq: null, name: null },
    ] as never);
    await waitFor(() =>
      expect(view.onSelect).toHaveBeenCalledWith({ institution: "kmutt", team: "t-new" }),
    );
  });
});
