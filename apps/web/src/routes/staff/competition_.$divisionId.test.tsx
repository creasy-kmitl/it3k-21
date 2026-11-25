import { afterEach, describe, expect, mock, test } from "bun:test";
import type { DivisionCompetitionInput } from "@it3k/db/competition-rules";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type { CompetitionDivision, CompetitionDivisionsApi } from "@/lib/competition-divisions";
import { fakeApis, loudFake } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { CompetitionSettingsPage } from "./competition_.$divisionId";

afterEach(cleanup);

const scoring = {
  engine: "points",
  buttons: [1],
  periods: { count: 2, label: "ครึ่ง" },
  overtime: null,
  targetScore: null,
  targetWinBy: null,
  allowDraw: true,
  shootout: null,
  clock: null,
};

function football(overrides: Partial<CompetitionDivision> = {}) {
  return {
    id: "d-football",
    code: "football",
    name: "ฟุตบอลชาย",
    format: "team",
    maxTeamsPerInstitution: 1,
    teamMinSize: 11,
    teamMaxSize: 25,
    genderMinimums: null,
    maxOfficials: 2,
    lineupStarters: 11,
    lineupMaxSubs: 14,
    scoringConfig: scoring,
    scoringIsDefault: true,
    standingsConfig: {
      win: 3,
      draw: 1,
      loss: 0,
      forfeit: 0,
      tiebreaks: ["headToHead", "scoreDiff"],
    },
    checkinMode: "kiosk",
    checkinOpensMin: 40,
    checkinClosesMin: 10,
    checkinMinPlayers: null,
    awardsMedals: true,
    version: 3,
    ...overrides,
  } as CompetitionDivision;
}

async function setup(api: Partial<CompetitionDivisionsApi>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider
        value={fakeApis({ competitionDivisions: loudFake("competitionDivisions", api) })}
      >
        <CompetitionSettingsPage divisionId="d-football" />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

describe("/staff/competition/$divisionId", () => {
  test("saves changed settings at the version read, keeping the default scoring as null", async () => {
    const save = mock(async (_id: string, _input: DivisionCompetitionInput) => ({
      division: football(),
    }));
    const view = await setup({
      get: async () => ({ division: football(), canManage: true }),
      save: save as unknown as CompetitionDivisionsApi["save"],
    });
    const max = await view.findByLabelText("นักกีฬาสูงสุด");
    expect(view.queryByRole("region", { name: "บันทึกการแก้ไข" })).toBeNull();
    fireEvent.change(max, { target: { value: "20" } });
    fireEvent.change(view.getByLabelText("หญิงอย่างน้อย"), { target: { value: "2" } });
    fireEvent.click(view.getByRole("button", { name: "เลื่อน ผลต่างคะแนนได้-เสีย ขึ้น" }));

    const bar = view.getByRole("region", { name: "บันทึกการแก้ไข" });
    fireEvent.click(within(bar).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [id, input] = save.mock.calls[0] as [string, DivisionCompetitionInput];
    expect(id).toBe("d-football");
    expect(input).toMatchObject({
      teamMaxSize: 20,
      genderMinimums: { female: 2 },
      scoringConfig: null,
      checkinMinPlayers: null,
      version: 3,
    });
    expect(input.standingsConfig?.tiebreaks).toEqual(["scoreDiff", "headToHead"]);
  });

  test("refuses a minimum above the maximum without calling the API", async () => {
    const save = mock(async () => ({ division: football() }));
    const view = await setup({
      get: async () => ({ division: football(), canManage: true }),
      save: save as unknown as CompetitionDivisionsApi["save"],
    });
    fireEvent.change(await view.findByLabelText("นักกีฬาขั้นต่ำ"), { target: { value: "30" } });
    const bar = view.getByRole("region", { name: "บันทึกการแก้ไข" });
    fireEvent.click(within(bar).getByRole("button", { name: "บันทึก" }));
    expect(await view.findByText("จำนวนขั้นต่ำต้องไม่เกินจำนวนสูงสุด")).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });

  test("readers see the settings without being able to change them", async () => {
    const view = await setup({ get: async () => ({ division: football(), canManage: false }) });
    expect(await view.findByText(/ดูได้อย่างเดียว/)).toBeTruthy();
    // The whole form sits in a disabled fieldset.
    expect(view.getByLabelText("นักกีฬาสูงสุด").matches(":disabled")).toBe(true);
  });
});
