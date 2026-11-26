import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { useState } from "react";

import { checkinMatch, matchCheckins } from "@/components/competition/checkin/fixtures";
import { ApiProvider } from "@/lib/api-context";
import type { CheckinList, CompetitionCheckinsApi } from "@/lib/competition-checkins";
import { fakeApis, loudFake } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { MatchCheckinPage, type MatchCheckinSearch } from "./match-checkin";

afterEach(cleanup);

const LIST: CheckinList = {
  items: [
    checkinMatch(),
    checkinMatch({
      id: "m-2",
      matchNo: 4,
      divisionName: "ROV",
      venueId: null,
      venueName: null,
      checkinMode: "manual",
    }),
  ],
  venues: [
    { id: "v-1", name: "สนามฟุตบอล" },
    { id: "v-2", name: "โรงยิม" },
  ],
  now: "2026-12-05T03:05:00.000Z",
  canForfeit: true,
};

function setup(overrides: Partial<CompetitionCheckinsApi> = {}, initial: MatchCheckinSearch = {}) {
  const competitionCheckins = loudFake<CompetitionCheckinsApi>("competitionCheckins", {
    list: async () => LIST,
    match: async () => matchCheckins(),
    ...overrides,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [search, setSearch] = useState<MatchCheckinSearch>(initial);
    return (
      <MatchCheckinPage
        search={search}
        onSearch={(patch) => setSearch((s) => ({ ...s, ...patch }))}
      />
    );
  }
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ competitionCheckins })}>
        <Harness />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

describe("/staff/match-checkin", () => {
  test("lists matches, filters by venue and links to the venue's kiosk", async () => {
    const view = await setup();
    expect(await view.findByText("ฟุตบอล · รอบแบ่งกลุ่ม · M3")).toBeTruthy();
    expect(view.getByText("ROV · รอบแบ่งกลุ่ม · M4")).toBeTruthy();
    expect(view.getByText("รายงานตัวโดยเจ้าหน้าที่ (ไม่ใช้ kiosk)")).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "สนามฟุตบอล" }));
    await waitFor(() => expect(view.queryByText("ROV · รอบแบ่งกลุ่ม · M4")).toBeNull());
    const kiosk = view.getByRole("button", { name: "เปิด kiosk ของ สนามฟุตบอล" });
    expect(kiosk.getAttribute("href")).toBe("/kiosk/matches/v-1");
  });

  test("ticking a player checks them in; unticking undoes it", async () => {
    const calls: unknown[] = [];
    const view = await setup({
      checkIn: async (matchId, participantId, userId) => {
        calls.push(["in", matchId, participantId, userId]);
        return {
          userId,
          participantId,
          method: "manual" as const,
          checkedInAt: "2026-12-05T03:06:00.000Z",
          checkedIn: 3,
          duplicate: false,
        };
      },
      undo: async (matchId, userId) => {
        calls.push(["out", matchId, userId]);
        return { userId, participantId: "s-1", checkedIn: 1 };
      },
    });
    fireEvent.click(await view.findByText("ฟุตบอล · รอบแบ่งกลุ่ม · M3"));
    const home = await view.findByRole("region", { name: "สจล." });
    const [scanned, waiting] = within(home).getAllByRole("checkbox");
    expect(scanned?.getAttribute("aria-checked")).toBe("true");
    expect(within(home).getByText(/สแกน/)).toBeTruthy();

    fireEvent.click(waiting as HTMLElement);
    await waitFor(() => expect(calls).toEqual([["in", "m-1", "s-1", "p2"]]));
    fireEvent.click(scanned as HTMLElement);
    await waitFor(() => expect(calls).toContainEqual(["out", "m-1", "p1"]));
  });

  test("after check-in closes, a short side can be forfeited once confirmed", async () => {
    const calls: unknown[] = [];
    const closed = checkinMatch({
      window: {
        state: "closed",
        opensAt: "2026-12-05T03:00:00.000Z",
        closesAt: "2026-12-05T03:30:00.000Z",
      },
    });
    const view = await setup(
      {
        match: async () => matchCheckins({ canForfeit: true }, closed),
        forfeit: async (matchId, participantIds, version) => {
          calls.push([matchId, participantIds, version]);
          return {
            matchId,
            status: "finished" as const,
            outcome: "forfeit" as const,
            version: 2,
            sides: [],
          };
        },
      },
      { match: "m-1" },
    );
    const button = await view.findByRole("button", { name: "ปรับแพ้ มจธ." });
    expect(view.queryByRole("button", { name: "ปรับแพ้ สจล." })).toBeNull();
    fireEvent.click(button);
    const dialog = await view.findByRole("alertdialog");
    expect(dialog.textContent).toContain("มจธ. รายงานตัว 0 จากขั้นต่ำ 2 คน");
    expect(dialog.textContent).toContain("อีกฝั่งชนะผ่าน");
    expect(calls).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันปรับแพ้" }));
    await waitFor(() => expect(calls).toEqual([["m-1", ["s-2"], 1]]));
  });

  test("no forfeit while check-in is still open", async () => {
    const view = await setup({}, { match: "m-1" });
    expect(await view.findByRole("region", { name: "มจธ." })).toBeTruthy();
    expect(view.queryByRole("button", { name: /ปรับแพ้/ })).toBeNull();
  });
});
