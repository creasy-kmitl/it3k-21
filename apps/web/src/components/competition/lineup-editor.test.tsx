import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type { CompetitionTeamsApi, LineupPage } from "@/lib/competition-teams";
import { fakeApis, loudFake, renderWithQuery } from "@/test/query";

import { LineupEditor, type LineupEditorProps } from "./lineup-editor";

afterEach(cleanup);

const member = (id: string, shirtNumber: number | null = null) => ({
  registrationId: id,
  userId: `u-${id}`,
  displayName: `ชื่อ${id}`,
  sortOrder: 0,
  status: "approved" as const,
  shirtNumber,
  badmintonRank: null,
  gender: null,
});

function lineupPage(overrides: Partial<LineupPage> = {}): LineupPage {
  return {
    team: {
      id: "t-1",
      label: "มจธ.",
      members: [member("a", 7), member("b"), member("c")],
    },
    starters: ["a"],
    subs: [],
    limits: { starters: 2, maxSubs: 1 },
    locked: false,
    canEdit: true,
    ...overrides,
  } as LineupPage;
}

const props: LineupEditorProps = {
  matchId: "m-1",
  participantId: "p-1",
  teamId: "t-1",
  starters: 2,
  maxSubs: 1,
  canEdit: true,
};

function setup(api: Partial<CompetitionTeamsApi>, overrides: Partial<LineupEditorProps> = {}) {
  return renderWithQuery(
    <ApiProvider value={fakeApis({ competitionTeams: loudFake("competitionTeams", api) })}>
      <LineupEditor {...props} {...overrides} />
    </ApiProvider>,
  );
}

describe("LineupEditor", () => {
  test("picks starters and subs within the limits and saves them", async () => {
    const saveLineup = mock(async () => ({ starters: ["a", "b"], subs: ["c"] }));
    const onSaved = mock(() => undefined);
    const view = setup({ lineup: async () => lineupPage(), saveLineup }, { onSaved });

    expect(await view.findByText("ตัวจริง 1 / 2 · สำรอง 0 / 1")).toBeTruthy();
    const save = view.getByRole("button", { name: "บันทึกรายชื่อ" });
    expect(save.hasAttribute("disabled")).toBe(true);

    const rowB = view.getByRole("group", { name: "ตำแหน่งของ ชื่อb" });
    fireEvent.click(within(rowB).getByRole("button", { name: "ตัวจริง" }));
    // Starters are full, so c may only sit on the bench.
    const rowC = view.getByRole("group", { name: "ตำแหน่งของ ชื่อc" });
    expect(within(rowC).queryByRole("button", { name: "ตัวจริง" })).toBeNull();
    fireEvent.click(within(rowC).getByRole("button", { name: "ตัวสำรอง" }));
    expect(view.getByText("ตัวจริง 2 / 2 · สำรอง 1 / 1")).toBeTruthy();

    fireEvent.click(save);
    await waitFor(() => expect(saveLineup).toHaveBeenCalledTimes(1));
    expect(saveLineup.mock.calls[0]).toEqual([
      "m-1",
      "p-1",
      { starters: ["a", "b"], subs: ["c"] },
    ] as never);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  test("shows a finished match's lineup read-only", async () => {
    const view = setup({ lineup: async () => lineupPage({ locked: true }) });
    expect(await view.findByText("แมตช์นี้จบแล้ว แก้รายชื่อไม่ได้")).toBeTruthy();
    expect(view.queryByRole("button", { name: "บันทึกรายชื่อ" })).toBeNull();
    expect(view.getByText("ตัวจริง")).toBeTruthy();
  });

  test("renders nothing when the division needs no lineup", () => {
    const view = setup({}, { starters: null });
    expect(view.container.textContent).toBe("");
  });
});
