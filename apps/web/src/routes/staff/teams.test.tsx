import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, within } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type {
  CompetitionDivision,
  CompetitionDivisionList,
  CompetitionDivisionsApi,
} from "@/lib/competition-divisions";
import type { CompetitionTeamsApi, Team, TeamList } from "@/lib/competition-teams";
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

async function setup(canManage: boolean) {
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

  test("readers get no settings links", async () => {
    const view = await setup(false);
    await view.findByRole("link", { name: /ฟุตบอลชาย/ });
    expect(view.queryByLabelText(/ตั้งค่าการแข่งขัน/)).toBeNull();
  });
});
