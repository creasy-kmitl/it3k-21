import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import { checkinMatch, matchCheckins } from "@/components/competition/checkin/fixtures";
import { ApiProvider } from "@/lib/api-context";
import type { CompetitionCheckinsApi, ScanOutcome } from "@/lib/competition-checkins";
import { ApiError } from "@/lib/leadership";
import { fakeApis, loudFake } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { MatchKioskPage } from "./kiosk.matches.$matchId";

afterEach(cleanup);

const PERSON = {
  userId: "p1",
  name: "สมชาย",
  image: null,
  institution: "kmitl" as const,
  shirtNumber: 7,
};

function setup(overrides: Partial<CompetitionCheckinsApi> = {}) {
  const competitionCheckins = loudFake<CompetitionCheckinsApi>("competitionCheckins", {
    match: async () => matchCheckins(),
    ...overrides,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ competitionCheckins })}>
        <MatchKioskPage
          matchId="m-1"
          decoderFactory={() => Promise.reject(new Error("no camera"))}
        />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

async function scan(view: Awaited<ReturnType<typeof setup>>, code: string) {
  const box = await view.findByLabelText("รหัสเช็คอินกีฬา");
  fireEvent.change(box, { target: { value: code } });
  fireEvent.submit(box.closest("form") as HTMLFormElement);
}

describe("/kiosk/matches/$matchId", () => {
  test("shows the match, each side against the minimum and who has reported in", async () => {
    const view = await setup();
    expect(await view.findByText("ฟุตบอล · รอบแบ่งกลุ่ม · M3")).toBeTruthy();
    expect(view.getByText("สจล. รายงานตัว 2 จากขั้นต่ำ 2 คน")).toBeTruthy();
    expect(view.getByText("เปิดรายงานตัว ถึง 10:30")).toBeTruthy();
    const home = view.getByRole("region", { name: "รายชื่อ สจล." });
    expect(within(home).getAllByLabelText("รายงานตัวแล้ว")).toHaveLength(1);
    expect(within(home).getAllByLabelText("ยังไม่รายงานตัว")).toHaveLength(1);
    expect(view.getByRole("button", { name: "ออก" }).getAttribute("href")).toBe(
      "/staff/matches/m-1",
    );
  });

  test("a scan checks the athlete in to this match and fills the screen", async () => {
    const calls: unknown[] = [];
    const view = await setup({
      scan: async (matchId, code): Promise<ScanOutcome> => {
        calls.push([matchId, code]);
        return {
          code: "checked-in",
          checkedInAt: "2026-12-05T03:05:00.000Z",
          person: PERSON,
          match: checkinMatch(),
          side: { participantId: "s-1", label: "สจล.", checkedIn: 3, min: 2 },
        };
      },
    });
    await scan(view, " 004213 ");
    expect(await view.findByRole("alertdialog", { name: "รายงานตัวสำเร็จ" })).toBeTruthy();
    expect(view.getByText("#7 สมชาย")).toBeTruthy();
    expect(view.getByText("สจล. รายงานตัวแล้ว 3 / 2 คน")).toBeTruthy();
    expect(calls).toEqual([["m-1", "004213"]]);

    // The same badge again right away is ignored.
    fireEvent.click(view.getByRole("alertdialog"));
    await scan(view, "004213");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(1);
  });

  test("an athlete of another match is told so in red", async () => {
    const view = await setup({
      scan: async () => ({
        code: "not-in-match",
        message: "นักกีฬาคนนี้ไม่ได้อยู่ในทีมของแมตช์นี้",
        person: PERSON,
      }),
    });
    await scan(view, "004213");
    const dialog = await view.findByRole("alertdialog", {
      name: "นักกีฬาคนนี้ไม่ได้อยู่ในทีมของแมตช์นี้",
    });
    expect(dialog.className).toContain("bg-destructive");
  });

  test("too early shows when check-in opens", async () => {
    const view = await setup({
      scan: async () => ({
        code: "too-early",
        message: "ยังไม่เปิดรายงานตัว",
        person: PERSON,
        match: checkinMatch(),
        opensAt: "2026-12-05T04:00:00.000Z",
      }),
    });
    await scan(view, "004213");
    expect(
      await view.findByRole("alertdialog", { name: "ยังไม่เปิดรายงานตัว (เปิด 11:00)" }),
    ).toBeTruthy();
  });

  test("an account without check-in rights is told so", async () => {
    const view = await setup({
      match: async () => {
        throw new ApiError(403, "คุณไม่มีสิทธิ์ทำรายการนี้");
      },
    });
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toBe("บัญชีนี้ไม่มีสิทธิ์ใช้ Kiosk รายงานตัวแข่งขัน"),
    );
  });
});
