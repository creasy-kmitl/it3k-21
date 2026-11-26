import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type {
  CompetitionDivision,
  CompetitionDivisionList,
  CompetitionDivisionsApi,
} from "@/lib/competition-divisions";
import type { AutoTeamsPlan, CompetitionTeamsApi, Team, TeamList } from "@/lib/competition-teams";
import { fakeApis, loudFake } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { TeamsOverview } from "./teams";

afterEach(cleanup);

const division = (id: string, name: string, sportId: string, sportName: string) =>
  ({ id, name, sportId, sportName, sportIcon: "football" }) as CompetitionDivision;

const team = (divisionId: string, issues: number) =>
  ({
    id: `${divisionId}-${Math.random()}`,
    divisionId,
    issues: Array.from({ length: issues }, () => ({ code: "tooFew", message: "x" })),
  }) as unknown as Team;

const PLAN: AutoTeamsPlan = {
  applied: false,
  failed: [],
  skippedDivisions: ["แบดมินตัน เดี่ยวชาย"],
  divisions: [
    {
      id: "d-football",
      name: "ฟุตบอลชาย",
      sportName: "ฟุตบอล",
      sportIcon: "football",
      create: [
        { institution: "kmutt", members: 14, overMax: false },
        { institution: "kmitl", members: 25, overMax: true },
      ],
      skipped: [{ institution: "kmutnb-bangkok", reason: "arranged" }],
    },
  ],
};

async function setup(canManage: boolean, autoAll?: CompetitionTeamsApi["autoAll"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const divisions = {
    items: [
      division("d-football", "ฟุตบอลชาย", "s-football", "ฟุตบอล"),
      division("d-single", "แบดมินตัน เดี่ยวชาย", "s-badminton", "แบดมินตัน"),
      division("d-double", "แบดมินตัน คู่ชาย", "s-badminton", "แบดมินตัน"),
    ],
    canManage,
  } as CompetitionDivisionList;
  const teams = {
    items: [team("d-football", 0), team("d-football", 2), team("d-single", 0)],
    canManage,
  } as TeamList;
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider
        value={fakeApis({
          competitionDivisions: loudFake<CompetitionDivisionsApi>("competitionDivisions", {
            list: async () => divisions,
          }),
          competitionTeams: loudFake<CompetitionTeamsApi>("competitionTeams", {
            list: async () => teams,
            ...(autoAll ? { autoAll } : {}),
          }),
        })}
      >
        <TeamsOverview />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

describe("/staff/teams", () => {
  test("lists divisions by sport with team counts and teams that lack something", async () => {
    const view = await setup(true);
    const badminton = await view.findByRole("region", { name: "แบดมินตัน" });
    expect(within(badminton).getAllByRole("link", { name: /แบดมินตัน/ })).toHaveLength(2);
    const football = view.getByRole("link", { name: /ฟุตบอลชาย/ });
    expect(within(football).getByText(/2 ทีม/)).toBeTruthy();
    expect(within(football).getByText("1 เรื่อง")).toBeTruthy();
    expect(view.getByRole("link", { name: /แบดมินตัน คู่ชาย/ }).textContent).toContain("0 ทีม");
    // Base UI gives the icon link a button role.
    const settings = view.getByRole("button", { name: "ตั้งค่าการแข่งขัน ฟุตบอลชาย" });
    expect(settings.getAttribute("href")).toBe("/staff/competition/d-football");
  });

  test("auto for every division shows its plan, without badminton, before making teams", async () => {
    const calls: boolean[] = [];
    const view = await setup(true, async ({ dryRun }) => {
      calls.push(dryRun);
      return { ...PLAN, applied: !dryRun };
    });
    fireEvent.click(await view.findByRole("button", { name: "จัดทีมอัตโนมัติทุกประเภท" }));
    const dialog = await view.findByRole("alertdialog");
    expect(within(dialog).getByText("จัดทีมอัตโนมัติ 1 ประเภท สร้าง 2 ทีม")).toBeTruthy();
    expect(within(dialog).getByText("ไม่รวมกีฬาแบดมินตัน")).toBeTruthy();
    expect(within(dialog).getByText(/ข้ามมหาลัยที่จัดทีมไว้แล้ว 1 รายการ/)).toBeTruthy();
    expect(within(dialog).getByText("เกินจำนวนสูงสุด")).toBeTruthy();
    expect(calls).toEqual([true]);
    fireEvent.click(within(dialog).getByRole("button", { name: "สร้าง 2 ทีม" }));
    await waitFor(() => expect(calls).toEqual([true, false]));
    await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull());
  });

  test("readers get no settings links", async () => {
    const view = await setup(false);
    await view.findByRole("link", { name: /ฟุตบอลชาย/ });
    expect(view.queryByLabelText(/ตั้งค่าการแข่งขัน/)).toBeNull();
    expect(view.queryByRole("button", { name: "จัดทีมอัตโนมัติทุกประเภท" })).toBeNull();
  });
});
