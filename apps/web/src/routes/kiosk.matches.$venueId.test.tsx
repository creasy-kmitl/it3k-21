import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import { checkinMatch } from "@/components/competition/checkin/fixtures";
import { ApiProvider } from "@/lib/api-context";
import type {
  CompetitionCheckinsApi,
  ScanOutcome,
  VenueCheckins,
} from "@/lib/competition-checkins";
import { ApiError } from "@/lib/leadership";
import { fakeApis, loudFake } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { MatchKioskPage } from "./kiosk.matches.$venueId";

afterEach(cleanup);

const STATE: VenueCheckins = {
  venue: { id: "v-1", name: "สนามฟุตบอล" },
  now: "2026-12-05T03:05:00.000Z",
  matches: [checkinMatch()],
  next: null,
};

const PERSON = {
  userId: "p1",
  name: "สมชาย",
  image: null,
  institution: "kmitl" as const,
  shirtNumber: 7,
};

function setup(overrides: Partial<CompetitionCheckinsApi> = {}) {
  const competitionCheckins = loudFake<CompetitionCheckinsApi>("competitionCheckins", {
    venue: async () => STATE,
    ...overrides,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ competitionCheckins })}>
        <MatchKioskPage
          venueId="v-1"
          decoderFactory={() => Promise.reject(new Error("no camera"))}
        />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

async function scan(view: Awaited<ReturnType<typeof setup>>, code: string) {
  const box = await view.findByLabelText("รหัสตั๋วหรือรหัสผู้ใช้");
  fireEvent.change(box, { target: { value: code } });
  fireEvent.submit(box.closest("form") as HTMLFormElement);
}

describe("/kiosk/matches/$venueId", () => {
  test("shows the venue's open matches with each side against the minimum", async () => {
    const view = await setup();
    expect(await view.findByText("สนามฟุตบอล")).toBeTruthy();
    expect(view.getByText("ฟุตบอล · รอบแบ่งกลุ่ม · M3")).toBeTruthy();
    expect(view.getByText("สจล. รายงานตัว 2 จากขั้นต่ำ 2 คน")).toBeTruthy();
    expect(view.getByText("มจธ. รายงานตัว 0 จากขั้นต่ำ 2 คน")).toBeTruthy();
    expect(view.getByText("เปิดรายงานตัว ถึง 10:30")).toBeTruthy();
    expect(view.getByRole("button", { name: "ออก" }).getAttribute("href")).toBe(
      "/staff/match-checkin?venue=v-1",
    );
  });

  test("a scan checks the athlete in and fills the screen", async () => {
    const calls: unknown[] = [];
    const view = await setup({
      scan: async (venueId, code): Promise<ScanOutcome> => {
        calls.push([venueId, code]);
        return {
          code: "checked-in",
          checkedInAt: "2026-12-05T03:05:00.000Z",
          person: PERSON,
          match: checkinMatch(),
          side: { participantId: "s-1", label: "สจล.", checkedIn: 3, min: 2 },
        };
      },
    });
    await scan(view, " p1 ");
    expect(await view.findByRole("alertdialog", { name: "รายงานตัวสำเร็จ" })).toBeTruthy();
    expect(view.getByText("#7 สมชาย")).toBeTruthy();
    expect(view.getByText("สจล. รายงานตัวแล้ว 3 / 2 คน")).toBeTruthy();
    expect(calls).toEqual([["v-1", "p1"]]);

    // The same badge again right away is ignored.
    fireEvent.click(view.getByRole("alertdialog"));
    await scan(view, "p1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(1);
  });

  test("a refused scan says why in red", async () => {
    const view = await setup({
      scan: async () => ({
        code: "ticket",
        message: "นี่คือ QR ตั๋วกิจกรรม ใช้บาร์โค้ดในหน้าโปรไฟล์ของนักกีฬาเพื่อรายงานตัวแข่งขัน",
      }),
    });
    await scan(view, "it3k-t:abc");
    const dialog = await view.findByRole("alertdialog");
    expect(dialog.textContent).toContain("QR ตั๋วกิจกรรม");
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
    await scan(view, "p1");
    expect(
      await view.findByRole("alertdialog", { name: "ยังไม่เปิดรายงานตัว (เปิด 11:00)" }),
    ).toBeTruthy();
  });

  test("with nothing open, it names the next match", async () => {
    const view = await setup({
      venue: async () => ({
        ...STATE,
        matches: [],
        next: checkinMatch({
          window: {
            state: "early",
            opensAt: "2026-12-05T04:00:00.000Z",
            closesAt: "2026-12-05T04:30:00.000Z",
          },
        }),
      }),
    });
    expect(await view.findByText("ยังไม่มีแมตช์ที่เปิดรายงานตัว")).toBeTruthy();
    expect(view.getByText("ถัดไป: ฟุตบอล · รอบแบ่งกลุ่ม · M3 · เปิดรายงานตัว 11:00")).toBeTruthy();
  });

  test("an account without check-in rights is told so", async () => {
    const view = await setup({
      venue: async () => {
        throw new ApiError(403, "คุณไม่มีสิทธิ์ทำรายการนี้");
      },
    });
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toBe("บัญชีนี้ไม่มีสิทธิ์ใช้ Kiosk รายงานตัวแข่งขัน"),
    );
  });
});
