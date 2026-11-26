import { afterEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, screen, waitFor } from "@testing-library/react";

import { HOUR, MORNING, publicMatch } from "@/components/public/test-fixtures";
import { ApiProvider } from "@/lib/api-context";
import type { MatchFilters, PublicCompetitionApi } from "@/lib/public-competition";
import { fakeApis, loudFake } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { MatchesView } from "./matches";

afterEach(cleanup);

function setup(
  api: Partial<PublicCompetitionApi>,
  filters: MatchFilters = {},
  view: "list" | "bracket" = "list",
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const apis = fakeApis({
    publicCompetition: loudFake<PublicCompetitionApi>("publicCompetition", api),
  });
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={apis}>
        <MatchesView filters={filters} onChange={() => {}} view={view} onViewChange={() => {}} />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

const filters = async () => ({ sports: [], venues: [], days: [] });

describe("matches page", () => {
  test("groups matches by Bangkok day, with scores and status", async () => {
    const matches = mock(async () => ({
      items: [
        publicMatch({
          id: "m-1",
          status: "finished",
          sides: publicMatch().sides.map((side, i) => ({ ...side, score: i === 0 ? 2 : 0 })),
        }),
        publicMatch({ id: "m-2", startAt: MORNING + 24 * HOUR, matchNo: 4 }),
        publicMatch({ id: "m-3", startAt: null }),
      ],
    }));
    await setup({ filters, matches }, { sportId: "s-football" });

    expect(await screen.findByRole("heading", { name: /25 ธันวาคม/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /26 ธันวาคม/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /ยังไม่กำหนดวัน/ })).toBeTruthy();
    expect(screen.getByText("จบแล้ว")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(matches).toHaveBeenCalledWith({ sportId: "s-football" });
    const links = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links).toContain("/matches/m-1");
  });

  test("says so when nothing matches", async () => {
    await setup({ filters, matches: async () => ({ items: [] }) });
    await waitFor(() => expect(screen.getByText("ไม่พบแมตช์")).toBeTruthy());
  });

  test("the bracket view joins a final to the semi-final whose winner it waits on", async () => {
    const matches = mock(async () => ({
      items: [
        publicMatch({ id: "m-sf", matchNo: 1, stageName: "รอบรองชนะเลิศ" }),
        publicMatch({
          id: "m-final",
          matchNo: 2,
          stageName: "ชิงชนะเลิศ",
          sides: publicMatch().sides.map((side, i) =>
            i === 0
              ? {
                  ...side,
                  team: null,
                  name: "ผู้ชนะ M1",
                  sourceMatchId: "m-sf",
                  sourceResult: "winner" as const,
                }
              : side,
          ),
        }),
      ],
    }));
    await setup({ filters, matches }, { sportId: "s-football", day: "2026-12-25" }, "bracket");
    expect(await screen.findByText("ผู้ชนะ M1")).toBeTruthy();
    // A bracket ignores the day: it needs every round.
    expect(matches).toHaveBeenCalledWith({ sportId: "s-football" });
    expect(screen.queryByRole("searchbox", { name: "ค้นหาแมตช์" })).toBeNull();
    const links = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links).toEqual(expect.arrayContaining(["/matches/m-sf", "/matches/m-final"]));
  });
});
