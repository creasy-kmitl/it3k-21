import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, screen, within } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type { Medals, PublicCompetitionApi, Standings } from "@/lib/public-competition";
import { fakeApis, loudFake } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { StandingsView } from "./standings";

afterEach(cleanup);

const row = (rank: number, name: string, points: number) => ({
  teamId: `t-${name}`,
  team: { id: `t-${name}`, name, institution: "kmitl" as const },
  played: 2,
  wins: points / 3,
  draws: 0,
  losses: 2 - points / 3,
  forfeits: 0,
  scoreFor: 3,
  scoreAgainst: 1,
  scoreDiff: 2,
  setsFor: 0,
  setsAgainst: 0,
  pointsFor: 0,
  pointsAgainst: 0,
  points,
  rank,
});

const standings: Standings = {
  divisions: [
    {
      id: "d-football",
      name: "ฟุตบอล",
      sport: { id: "s", name: "กีฬาฟุตบอล", icon: "football" },
      points: { win: 3, draw: 1, loss: 0, forfeit: 0 },
      tiebreaks: ["headToHead", "scoreDiff"],
      groups: [
        {
          id: "g-a",
          stageName: "รอบแบ่งกลุ่ม",
          name: "สาย A",
          rows: [row(1, "มจธ.", 6), row(2, "สจล.", 3)],
        },
      ],
    },
  ],
};

const medals: Medals = {
  rows: [
    { institution: "kmutt", gold: 1, silver: 0, bronze: 0, fourth: 0, points: 4, rank: 1 },
    { institution: "kmitl", gold: 0, silver: 1, bronze: 0, fourth: 0, points: 3, rank: 2 },
  ],
  divisions: [
    {
      id: "d-chair",
      name: "แชร์บอล ทีมชาย",
      sport: { name: "แชร์บอล", icon: "general" },
      counted: false,
      places: [{ place: 1, team: { id: "t-1", name: "สจล.", institution: "kmitl" } }],
    },
  ],
};

describe("standings page", () => {
  test("shows the medal table, division results and group tables", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const apis = fakeApis({
      publicCompetition: loudFake<PublicCompetitionApi>("publicCompetition", {
        standings: async () => standings,
        medals: async () => medals,
      }),
    });
    await renderAtRoot(() => (
      <QueryClientProvider client={client}>
        <ApiProvider value={apis}>
          <StandingsView />
        </ApiProvider>
      </QueryClientProvider>
    ));

    const tables = await screen.findAllByRole("table");
    expect(tables).toHaveLength(2);
    const [medalTable, groupTable] = tables as [HTMLElement, HTMLElement];
    expect(within(medalTable).getAllByRole("row")[1]?.textContent).toContain("มจธ.");
    expect(within(groupTable).getAllByRole("row")[1]?.textContent).toContain("มจธ.");
    expect(screen.getByText("รอบแบ่งกลุ่ม · สาย A")).toBeTruthy();
    expect(screen.getByText(/ผลการพบกัน > ผลต่างคะแนนได้-เสีย/)).toBeTruthy();
    expect(screen.getByText("ไม่นับคะแนน")).toBeTruthy();
  });
});
