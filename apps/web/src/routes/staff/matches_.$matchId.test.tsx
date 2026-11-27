import { afterEach, describe, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import { detail, setup, side } from "@/components/competition/match-test-fixtures";
import { matchCheckins } from "@/components/competition/checkin/fixtures";
import { ApiProvider } from "@/lib/api-context";
import type { CompetitionCheckinsApi } from "@/lib/competition-checkins";
import type { CompetitionMatchesApi, MatchDetail } from "@/lib/competition-matches";
import { choose, fakeApis, loudFake } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { MatchPage } from "./matches_.$matchId";

afterEach(cleanup);

async function render(
  match: MatchDetail,
  options: {
    canManage?: boolean;
    canCheckin?: boolean;
    overrides?: Partial<CompetitionMatchesApi>;
    checkins?: Partial<CompetitionCheckinsApi>;
  } = {},
) {
  const { canManage = true, canCheckin = false, overrides = {}, checkins = {} } = options;
  const api = loudFake<CompetitionMatchesApi>("competitionMatches", {
    get: async () => ({ match, canManage, canScore: true, canCheckin }) as never,
    ...overrides,
  });
  const competitionCheckins = loudFake<CompetitionCheckinsApi>("competitionCheckins", checkins);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ competitionMatches: api, competitionCheckins })}>
        <MatchPage matchId={match.id} onDeleted={() => {}} />
      </ApiProvider>
    </QueryClientProvider>
  ));
  return view;
}

describe("/staff/matches/$matchId", () => {
  test("shows the match, its sides and a link to the scorer; readers get no edit controls", async () => {
    const view = await render(
      detail({ referees: [{ id: "r-1", name: "สมศักดิ์", role: "ผู้ตัดสิน", sortOrder: 0 }] }),
      {
        canManage: false,
      },
    );
    expect(await view.findByRole("heading", { name: /M1 · รอบแบ่งกลุ่ม · สาย A/ })).toBeTruthy();
    const sides = view.getByRole("region", { name: "ผู้แข่ง" });
    expect(within(sides).getByText("สจล.")).toBeTruthy();
    expect(within(sides).getByText("มจธ.")).toBeTruthy();
    expect(view.getByRole("button", { name: /บันทึกคะแนน/ })).toBeTruthy();
    expect(view.getByText("สมศักดิ์")).toBeTruthy();
    expect(view.queryByRole("button", { name: /แก้ไข/ })).toBeNull();
    expect(view.queryByRole("button", { name: "เปลี่ยนสถานะ" })).toBeNull();
  });

  test("managers change the status with the version they read", async () => {
    const setStatus = mock(async () => ({ match: detail({ status: "postponed", version: 2 }) }));
    const view = await render(detail(), {
      overrides: { setStatus: setStatus as unknown as CompetitionMatchesApi["setStatus"] },
    });
    await choose(await view.findByRole("combobox", { name: "เปลี่ยนสถานะเป็น" }), "เลื่อน");
    fireEvent.click(view.getByRole("button", { name: "เปลี่ยนสถานะ" }));
    await waitFor(() =>
      expect(setStatus).toHaveBeenCalledWith("m-1", { status: "postponed", version: 1 }),
    );
    expect(await view.findByText("เลื่อน", { selector: "[data-slot=badge]" })).toBeTruthy();
  });

  test("a finished match has no status control", async () => {
    const view = await render(detail({ status: "finished" }));
    await view.findByRole("heading", { name: /M1/ });
    expect(view.queryByRole("button", { name: "เปลี่ยนสถานะ" })).toBeNull();
  });

  test("managers put the real team in for a placeholder", async () => {
    const assignTeam = mock(async () => ({ match: detail() }));
    const match = detail({
      participants: [
        side(),
        side({ id: "p-2", slot: 2, teamId: null, label: "ผู้ชนะ M3", name: "ผู้ชนะ M3" }),
      ],
    });
    const view = await render(match, {
      overrides: {
        assignTeam: assignTeam as unknown as CompetitionMatchesApi["assignTeam"],
        setup: async () => setup(),
      },
    });
    const picker = await view.findByRole("combobox", { name: "ทีมที่เข้ามาแทน" });
    await choose(picker, "มจพ. กรุงเทพฯ");
    fireEvent.click(view.getByRole("button", { name: "ใส่ทีม" }));
    await waitFor(() =>
      expect(assignTeam).toHaveBeenCalledWith("m-1", "p-2", { teamId: "team-bkk", version: 1 }),
    );
  });

  test("managers add a referee", async () => {
    const addReferee = mock(async () => ({
      match: detail({ referees: [{ id: "r-1", name: "สมใจ", role: "ผู้ตัดสิน", sortOrder: 0 }] }),
    }));
    const view = await render(detail(), {
      overrides: { addReferee: addReferee as unknown as CompetitionMatchesApi["addReferee"] },
    });
    fireEvent.change(await view.findByRole("textbox", { name: "ชื่อกรรมการ" }), {
      target: { value: "สมใจ" },
    });
    fireEvent.click(view.getByRole("button", { name: "เพิ่มกรรมการ" }));
    await waitFor(() =>
      expect(addReferee).toHaveBeenCalledWith("m-1", { name: "สมใจ", role: "ผู้ตัดสิน", sortOrder: 0 }),
    );
    expect(await view.findByText("สมใจ")).toBeTruthy();
  });

  test("staff who check athletes in see the rosters, tick them in and open the kiosk", async () => {
    const checkIn = mock(async () => ({}));
    const view = await render(detail(), {
      canCheckin: true,
      checkins: {
        match: async () => matchCheckins(),
        checkIn: checkIn as unknown as CompetitionCheckinsApi["checkIn"],
      },
    });
    const section = await view.findByRole("region", { name: "รายงานตัว" });
    expect(await within(section).findByText("เปิดรายงานตัว ถึง 10:30 · ขั้นต่ำ 2 คนต่อฝั่ง")).toBeTruthy();
    expect(within(section).getByRole("button", { name: /เปิด kiosk/ }).getAttribute("href")).toBe(
      "/kiosk/matches/m-1",
    );
    fireEvent.click(within(section).getByRole("checkbox", { name: /สมหญิง/ }));
    await waitFor(() => expect(checkIn).toHaveBeenCalledWith("m-1", "s-1", "p2"));
  });

  test("a division checked in by staff has no kiosk button", async () => {
    const view = await render(detail(), {
      canCheckin: true,
      checkins: {
        match: async () => ({
          ...matchCheckins(),
          match: { ...matchCheckins().match, checkinMode: "manual" },
        }),
      },
    });
    const section = await view.findByRole("region", { name: "รายงานตัว" });
    expect(await within(section).findByText(/รายงานตัวผ่าน Discord/)).toBeTruthy();
    expect(within(section).queryByRole("button", { name: /เปิด kiosk/ })).toBeNull();
  });

  test("staff without check-in rights see no check-in section", async () => {
    const view = await render(detail());
    await view.findByRole("heading", { name: /M1/ });
    expect(view.queryByRole("region", { name: "รายงานตัว" })).toBeNull();
  });
});
