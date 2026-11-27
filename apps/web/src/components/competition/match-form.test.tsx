import { afterEach, describe, expect, mock, test } from "bun:test";
import type { MatchInput } from "@it3k/db/competition-rules";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type { CompetitionMatchesApi } from "@/lib/competition-matches";
import { choose, fakeApis, loudFake } from "@/test/query";

import { MatchForm } from "./match-form";
import { detail, setup } from "./match-test-fixtures";

afterEach(cleanup);

function renderForm() {
  const create = mock(async (input: MatchInput) => ({
    match: detail({ id: "m-final", divisionId: input.divisionId }),
  }));
  const apis = fakeApis({
    competitionMatches: loudFake<CompetitionMatchesApi>("competitionMatches", {
      setup: async () => setup(),
      create: create as unknown as CompetitionMatchesApi["create"],
    }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ApiProvider value={apis}>
        <MatchForm
          divisions={[
            {
              id: "d-football",
              name: "ฟุตบอลชาย",
              sportId: "s-football",
              sportName: "ฟุตบอล",
              sportIcon: "football",
            },
          ]}
          venues={[]}
          initial={null}
          divisionId="d-football"
          onClose={() => {}}
          onSaved={() => {}}
        />
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { create };
}

describe("MatchForm knockout sides", () => {
  test("a side can wait on another match's winner instead of a typed name", async () => {
    const { create } = renderForm();
    const from = await screen.findByRole("combobox", { name: "ฝั่ง 1 มาจาก" });
    await waitFor(() => expect((from as HTMLButtonElement).disabled).toBe(false));
    await choose(from, "ผู้ชนะ M1");
    expect(screen.queryByRole("textbox", { name: "ชื่อชั่วคราวฝั่ง 1" })).toBeNull();
    await choose(screen.getByRole("combobox", { name: "ฝั่ง 2 มาจาก" }), "ผู้ชนะ M2");
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0].participants).toEqual([
      { teamId: null, label: null, source: { matchId: "m-semi-1", result: "winner" } },
      { teamId: null, label: null, source: { matchId: "m-semi-2", result: "winner" } },
    ]);
  });
});
