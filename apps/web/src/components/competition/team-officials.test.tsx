import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type { CompetitionTeamsApi, TeamOfficial } from "@/lib/competition-teams";
import { fakeApis, loudFake, renderWithQuery } from "@/test/query";

import { TeamOfficials } from "./team-officials";

afterEach(cleanup);

const coach: TeamOfficial = {
  id: "o-1",
  name: "โค้ชเอ",
  position: "ผู้ฝึกสอน",
  description: null,
  photoUrl: null,
  sortOrder: 0,
};

function setup(
  api: Partial<CompetitionTeamsApi>,
  props: { canManage?: boolean; max?: number } = {},
) {
  const onChanged = mock(() => undefined);
  const view = renderWithQuery(
    <ApiProvider value={fakeApis({ competitionTeams: loudFake("competitionTeams", api) })}>
      <TeamOfficials
        teamId="t-1"
        officials={[coach]}
        max={props.max ?? 2}
        canManage={props.canManage ?? true}
        onChanged={onChanged}
      />
    </ApiProvider>,
  );
  return { ...view, onChanged };
}

describe("TeamOfficials", () => {
  test("lists officials with the cap and removes one after confirming", async () => {
    const removeOfficial = mock(async () => ({ ok: true as const }));
    const view = setup({
      removeOfficial: removeOfficial as unknown as CompetitionTeamsApi["removeOfficial"],
    });
    expect(view.getByText("1 / 2")).toBeTruthy();
    expect(view.getByText("ผู้ฝึกสอน")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "ลบ โค้ชเอ" }));
    fireEvent.click(await view.findByRole("button", { name: "ลบ" }));
    await waitFor(() => expect(removeOfficial).toHaveBeenCalledWith("t-1", "o-1"));
    await waitFor(() => expect(view.onChanged).toHaveBeenCalled());
  });

  test("adding stops at the cap, and readers get no controls", () => {
    const full = setup({}, { max: 1 });
    expect(full.getByRole("button", { name: /เพิ่ม/ }).hasAttribute("disabled")).toBe(true);
    cleanup();
    const reader = setup({}, { canManage: false });
    expect(reader.queryByRole("button", { name: /เพิ่ม/ })).toBeNull();
    expect(reader.queryByRole("button", { name: "ลบ โค้ชเอ" })).toBeNull();
  });
});
