import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from "@tanstack/react-router";

import { MatchControlPage } from "@/components/scores/match-control-page";
import { NewMatchPage } from "@/components/scores/new-match-page";
import { ScoresPage } from "@/components/scores/scores-page";
import { ApiProvider } from "@/lib/api-context";
import { ApiError } from "@/lib/leadership";
import type { Match, MatchesApi, MatchInput, MatchUpdate } from "@/lib/matches";
import type { Sport } from "@/lib/sports";
import { choose, fakeApis, fakeMatchesApi, fakeSportsApi, match } from "@/test/query";

afterEach(cleanup);

/** What the sports page holds: only the names the match form reads. */
const SPORTS = [
  {
    id: "s-basketball",
    name: "บาสเก็ตบอล",
    divisions: [
      { id: "d-5x5", name: "บาสเกตบอล ทีมชาย (5x5)" },
      { id: "d-3x3", name: "บาสเกตบอล ทีมหญิง (3x3)" },
    ],
  },
  { id: "s-football", name: "ฟุตบอล", divisions: [] },
] as Sport[];

function ControlRoute() {
  const { matchId } = useParams({ strict: false });
  return <MatchControlPage matchId={matchId ?? ""} />;
}

/** The scores pages in a memory router at their real paths, so links between them work. */
async function setup(api: Partial<MatchesApi>, path = "/staff/scores") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const root = createRootRoute({ component: Outlet });
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/staff/scores", component: ScoresPage }),
    createRoute({
      getParentRoute: () => root,
      path: "/staff/scores/new",
      component: NewMatchPage,
    }),
    createRoute({
      getParentRoute: () => root,
      path: "/staff/scores/$matchId",
      component: ControlRoute,
    }),
    createRoute({ getParentRoute: () => root, path: "/scores", component: () => <p>board</p> }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await act(() => router.load());
  return render(
    <QueryClientProvider client={client}>
      <ApiProvider
        value={fakeApis({
          matches: fakeMatchesApi(api),
          sports: fakeSportsApi({ list: async () => ({ items: SPORTS, canManage: false }) }),
        })}
      >
        <RouterProvider router={router} />
      </ApiProvider>
    </QueryClientProvider>,
  );
}

describe("staff scores page", () => {
  test("lists matches with their scores; a card opens that match", async () => {
    await setup({
      list: async () => ({
        items: [match({ id: "m1", scoreA: 2, scoreB: 1, status: "finished" })],
      }),
    });
    expect(await screen.findByText("ฟุตบอล")).toBeDefined();
    expect(screen.getByLabelText("คะแนน มจธ.").textContent).toBe("2");
    expect(screen.getByLabelText("คะแนน สจล.").textContent).toBe("1");
    expect(screen.queryByLabelText("เพิ่มคะแนน มจธ.")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: /เปิดแมตช์ ฟุตบอล มจธ\. พบ สจล\./ }));
    expect(await screen.findByRole("heading", { name: "ฟุตบอล" })).toBeDefined();
    expect(screen.getByLabelText("เพิ่มคะแนน มจธ.")).toBeDefined();
  });

  test("+ on a live match adds the chosen step, with the version it read", async () => {
    let items: Match[] = [match({ id: "m1", scoreA: 1, scoreB: 0, status: "live", version: 4 })];
    const sent: { id: string; input: MatchUpdate }[] = [];
    await setup(
      {
        list: async () => ({ items }),
        update: async (id, input) => {
          sent.push({ id, input });
          items = [{ ...(items[0] as Match), ...input, version: 5 }];
          return items[0] as Match;
        },
      },
      "/staff/scores/m1",
    );
    fireEvent.click(await screen.findByRole("button", { name: "+3" }));
    fireEvent.click(screen.getByLabelText("เพิ่มคะแนน มจธ."));
    await waitFor(() => expect(screen.getByLabelText("คะแนน มจธ.").textContent).toBe("4"));
    expect(sent).toEqual([{ id: "m1", input: { version: 4, scoreA: 4 } }]);
  });

  test("a match starts by itself at its time; there is no start button", async () => {
    await setup(
      {
        list: async () => ({
          items: [
            match({ id: "m1", status: "scheduled", startsAt: Date.UTC(2099, 0, 1), scoreA: 0 }),
          ],
        }),
      },
      "/staff/scores/m1",
    );
    const plus = await screen.findByLabelText("เพิ่มคะแนน มจธ.");
    expect((plus as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/แมตช์เริ่มเองเวลา/)).toBeDefined();
    expect(screen.queryByRole("button", { name: "เริ่มแข่ง" })).toBeNull();
    cleanup();

    // Once its start time has passed, the same match is live and scores move.
    await setup(
      {
        list: async () => ({
          items: [match({ id: "m1", status: "scheduled", startsAt: Date.now() - 60_000 })],
        }),
      },
      "/staff/scores/m1",
    );
    const live = await screen.findByLabelText("เพิ่มคะแนน มจธ.");
    expect((live as HTMLButtonElement).disabled).toBe(false);
  });

  test("points cannot be added during a planned break", async () => {
    // Kicked off 50 minutes ago with a 15-minute break at minute 45: now inside it.
    await setup(
      {
        list: async () => ({
          items: [
            match({
              id: "m1",
              status: "live",
              startsAt: Date.now() - 50 * 60_000,
              durationMinutes: 90,
              breaks: [{ atMinute: 45, minutes: 15 }],
            }),
          ],
        }),
      },
      "/staff/scores/m1",
    );
    expect(await screen.findByText("พักครั้งที่ 1")).toBeDefined();
    expect((screen.getByLabelText("เพิ่มคะแนน มจธ.") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("เพิ่มคะแนน สจล.") as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    // Twenty minutes later the break is over and points count again.
    await setup(
      {
        list: async () => ({
          items: [
            match({
              id: "m1",
              status: "live",
              startsAt: Date.now() - 70 * 60_000,
              durationMinutes: 90,
              breaks: [{ atMinute: 45, minutes: 15 }],
            }),
          ],
        }),
      },
      "/staff/scores/m1",
    );
    const plus = await screen.findByLabelText("เพิ่มคะแนน มจธ.");
    expect((plus as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("พักครั้งที่ 1")).toBeNull();
  });

  test("an emergency stop pauses the match without ending it, then play carries on", async () => {
    let items: Match[] = [match({ id: "m1", status: "live", scoreA: 0, scoreB: 0 })];
    const sent: MatchUpdate[] = [];
    await setup(
      {
        list: async () => ({ items }),
        update: async (_id, input) => {
          sent.push(input);
          const current = items[0] as Match;
          items = [
            {
              ...current,
              pausedAt: input.paused ? Date.now() : null,
              version: current.version + 1,
            },
          ];
          return items[0] as Match;
        },
      },
      "/staff/scores/m1",
    );
    fireEvent.click(await screen.findByRole("button", { name: "หยุดฉุกเฉิน" }));
    expect(await screen.findByText("หยุดชั่วคราว")).toBeDefined();
    // Still live, not finished, but no points while play is stopped.
    expect((screen.getByLabelText("เพิ่มคะแนน มจธ.") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "จบแมตช์" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "แข่งต่อ" }));
    await waitFor(() =>
      expect(sent).toEqual([
        { version: 1, paused: true },
        { version: 2, paused: false },
      ]),
    );
    expect(await screen.findByRole("button", { name: "หยุดฉุกเฉิน" })).toBeDefined();
  });

  test("a stale edit reloads the match", async () => {
    let loads = 0;
    await setup(
      {
        list: async () => {
          loads++;
          return { items: [match({ id: "m1", status: "live", scoreA: 0, scoreB: 0 })] };
        },
        update: async () => {
          throw new ApiError(409, "stale", null);
        },
      },
      "/staff/scores/m1",
    );
    fireEvent.click(await screen.findByLabelText("เพิ่มคะแนน สจล."));
    await waitFor(() => expect(loads).toBe(2));
  });

  test("the timeline shows when each break falls on the clock", async () => {
    await setup(
      {
        list: async () => ({
          items: [
            match({
              id: "m1",
              startsAt: Date.UTC(2026, 10, 20, 3),
              durationMinutes: 90,
              breaks: [{ atMinute: 45, minutes: 15 }],
            }),
          ],
        }),
      },
      "/staff/scores/m1",
    );
    expect(await screen.findByText("พักครั้งที่ 1 · 10:45–11:00")).toBeDefined();
    expect(screen.getByText("จบ 11:45")).toBeDefined();
  });

  test("adds a match on its own page, then returns to the list", async () => {
    const created: MatchInput[] = [];
    await setup({
      create: async (input) => {
        created.push(input);
        return match();
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "เพิ่มแมตช์" }));
    expect(await screen.findByRole("heading", { name: "เพิ่มแมตช์" })).toBeDefined();
    // The division is picked after the sport and only from that sport's own list.
    const divisionBox = await screen.findByLabelText("ประเภท (ไม่บังคับ)");
    expect(divisionBox.hasAttribute("disabled") || divisionBox.getAttribute("aria-disabled")).toBeTruthy();
    await choose(await screen.findByLabelText("กีฬา"), "บาสเก็ตบอล");
    await choose(screen.getByLabelText("ประเภท (ไม่บังคับ)"), "บาสเกตบอล ทีมหญิง (3x3)");
    // A new match starts at 0 : 0, so the form asks for no score.
    expect(screen.queryByLabelText("คะแนนทีม A")).toBeNull();
    fireEvent.change(screen.getByLabelText("เวลาแข่ง"), { target: { value: "2026-11-20T10:00" } });
    fireEvent.change(screen.getByLabelText("แข่งกี่นาที (ไม่รวมพัก)"), { target: { value: "90" } });
    // Two breaks typed out of order come back sorted by minute.
    for (const [atMinute, minutes] of [
      ["60", "5"],
      ["30", "15"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: "เพิ่มช่วงพัก" }));
      const at = screen.getAllByLabelText(/นาทีที่$/).at(-1);
      const length = screen.getAllByLabelText(/นานกี่นาที$/).at(-1);
      if (!at || !length) throw new Error("break row missing");
      fireEvent.change(at, { target: { value: atMinute } });
      fireEvent.change(length, { target: { value: minutes } });
    }
    expect(screen.getByRole("img", { name: /แข่ง 90 นาที พัก 2 ครั้ง รวม 110 นาที/ })).toBeDefined();
    // Kick-off at 10:00, plus 90 minutes of play and 20 of breaks, ends at 11:50.
    expect(screen.getByText("เริ่ม 10:00")).toBeDefined();
    expect(screen.getByText("จบ 11:50")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toEqual({
      sport: "บาสเก็ตบอล",
      division: "บาสเกตบอล ทีมหญิง (3x3)",
      round: null,
      teamA: "kmutt",
      teamB: "kmutnb",
      status: "scheduled",
      startsAt: Date.UTC(2026, 10, 20, 3),
      durationMinutes: 90,
      breaks: [
        { atMinute: 30, minutes: 15 },
        { atMinute: 60, minutes: 5 },
      ],
    });
    expect(await screen.findByRole("heading", { name: "คะแนนการแข่งขัน" })).toBeDefined();
  });

  test("a sport that is not on the sports page is typed under other, division and all", async () => {
    const created: MatchInput[] = [];
    await setup(
      {
        create: async (input) => {
          created.push(input);
          return match();
        },
      },
      "/staff/scores/new",
    );
    expect(screen.queryByLabelText("ชื่อกีฬา")).toBeNull();
    await choose(await screen.findByLabelText("กีฬา"), "อื่นๆ");
    fireEvent.change(screen.getByLabelText("ชื่อกีฬา"), { target: { value: " วอลเลย์บอล " } });
    fireEvent.change(screen.getByLabelText("ประเภท (ไม่บังคับ)"), { target: { value: "ทีมผสม" } });
    fireEvent.change(screen.getByLabelText("เวลาแข่ง"), { target: { value: "2026-11-20T10:00" } });
    fireEvent.change(screen.getByLabelText("แข่งกี่นาที (ไม่รวมพัก)"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]?.sport).toBe("วอลเลย์บอล");
    expect(created[0]?.division).toBe("ทีมผสม");
  });

  test("a division that is not on the sport is typed under other", async () => {
    const created: MatchInput[] = [];
    await setup(
      {
        create: async (input) => {
          created.push(input);
          return match();
        },
      },
      "/staff/scores/new",
    );
    await choose(await screen.findByLabelText("กีฬา"), "บาสเก็ตบอล");
    expect(screen.queryByLabelText("ชื่อประเภท")).toBeNull();
    await choose(screen.getByLabelText("ประเภท (ไม่บังคับ)"), "อื่นๆ");
    fireEvent.change(screen.getByLabelText("ชื่อประเภท"), { target: { value: " ทีมผสม " } });
    fireEvent.change(screen.getByLabelText("เวลาแข่ง"), { target: { value: "2026-11-20T10:00" } });
    fireEvent.change(screen.getByLabelText("แข่งกี่นาที (ไม่รวมพัก)"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]?.division).toBe("ทีมผสม");
  });

  test("picking another sport empties the division, so it cannot leak across sports", async () => {
    await setup({}, "/staff/scores/new");
    await choose(await screen.findByLabelText("กีฬา"), "บาสเก็ตบอล");
    await choose(screen.getByLabelText("ประเภท (ไม่บังคับ)"), "อื่นๆ");
    fireEvent.change(screen.getByLabelText("ชื่อประเภท"), { target: { value: "ทีมผสม" } });
    await choose(screen.getByLabelText("กีฬา"), "ฟุตบอล");
    expect(screen.queryByLabelText("ชื่อประเภท")).toBeNull();
  });

  test("a new match needs its start time and minutes, and a break needs both boxes", async () => {
    await setup({}, "/staff/scores/new");
    await choose(await screen.findByLabelText("กีฬา"), "ฟุตบอล");
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มช่วงพัก" }));
    fireEvent.change(screen.getByLabelText("พักครั้งที่ 1 นาทีที่"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    expect(await screen.findByText("กรุณาเลือกเวลาแข่ง")).toBeDefined();
    expect(screen.getByText(/กรุณาใส่เวลาแข่ง/)).toBeDefined();
    expect(screen.getByText(/กรอกทั้งนาทีที่พัก และพักนานกี่นาที/)).toBeDefined();
  });

  test("refuses a score that is not a whole number when editing", async () => {
    await setup(
      { list: async () => ({ items: [match({ id: "m1", startsAt: Date.UTC(2026, 10, 20, 3) })] }) },
      "/staff/scores/m1",
    );
    fireEvent.click(await screen.findByRole("button", { name: "แก้ไขรายละเอียด" }));
    fireEvent.change(await screen.findByLabelText("คะแนนทีม A"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    expect(await screen.findByText(/คะแนนต้องเป็นจำนวนเต็ม/)).toBeDefined();
  });
});
