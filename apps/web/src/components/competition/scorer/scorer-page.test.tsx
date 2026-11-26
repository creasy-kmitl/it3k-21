import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ScoreEventInput, ScoringConfig } from "@it3k/db/competition-rules";
import { computeMatchState } from "@it3k/db/scoring/index";
import { DIVISION_PRESETS } from "@it3k/db/scoring/presets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type { CompetitionScoresApi, Scoreboard } from "@/lib/competition-scores";
import { fakeApis, loudFake } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { ScorerPage } from "./scorer-page";
import { lastUndoable, mergeEvents } from "./use-scorer";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const preset = (code: string) => DIVISION_PRESETS[code]?.scoringConfig as ScoringConfig;

function boardFor(
  scoring: ScoringConfig,
  overrides: Partial<Scoreboard["match"]> = {},
): Scoreboard {
  const sides = [
    { id: "home", name: "สจล." },
    { id: "away", name: "มจธ." },
  ].map((side, index) => ({
    ...side,
    slot: index + 1,
    teamId: `team-${side.id}`,
    institution: null,
    score: null,
    detail: null,
    resultValue: null,
    rank: null,
    outcome: null,
    players:
      side.id === "home"
        ? [
            {
              registrationId: "reg-10",
              displayName: "สมชาย",
              shirtNumber: 10,
              role: "starter" as const,
            },
          ]
        : [],
  }));
  return {
    match: {
      id: "m1",
      status: "live",
      outcome: null,
      stageName: "รอบแบ่งกลุ่ม",
      roundNo: null,
      matchNo: 3,
      court: "สนาม 1",
      friendly: false,
      parentMatchId: null,
      startAt: null,
      startedAt: 1,
      finishedAt: null,
      version: 4,
      scoreSeq: 0,
      division: { id: "d1", code: "x", name: "ชาย" },
      sport: { id: "s1", name: "บาสเกตบอล", icon: null },
      ...overrides,
    },
    scoring,
    sides,
    events: [],
    state: computeMatchState({
      config: scoring,
      participants: sides.map((s) => ({ id: s.id })),
      events: [],
    }),
    canScore: true,
  } as Scoreboard;
}

/** A fake API that keeps events like the server does and answers with the new board. */
function fakeServer(start: Scoreboard) {
  let board = start;
  const sent: ScoreEventInput[] = [];
  const voided: string[] = [];
  const server = {
    sent,
    voided,
    offline: false,
    finishCalls: [] as unknown[],
    get board() {
      return board;
    },
  };
  const recompute = (events: Scoreboard["events"]) => {
    const state = computeMatchState({
      config: board.scoring,
      participants: board.sides.map((s) => ({ id: s.id })),
      events,
    });
    board = {
      ...board,
      events,
      state,
      match: { ...board.match, scoreSeq: events.length },
      sides: board.sides.map((side) => {
        const p = state.participants.find((x) => x.participantId === side.id);
        return { ...side, score: p?.score ?? null, detail: p?.detail ?? null };
      }),
    };
    return board;
  };
  const api: Partial<CompetitionScoresApi> = {
    get: async () => board,
    addEvents: async (_matchId, events) => {
      if (server.offline) throw new TypeError("Failed to fetch");
      sent.push(...events);
      const known = new Set(board.events.map((e) => e.id));
      const fresh = events.filter((e) => !known.has(e.id));
      return recompute([
        ...board.events,
        ...fresh.map((e, i) => ({
          id: e.id,
          seq: board.events.length + i + 1,
          payload: e.payload,
          voided: false,
          createdAt: e.clientAt,
        })),
      ]);
    },
    voidEvent: async (_matchId, eventId) => {
      voided.push(eventId);
      return recompute(board.events.map((e) => (e.id === eventId ? { ...e, voided: true } : e)));
    },
    finish: async (_matchId, body) => {
      server.finishCalls.push(body);
      board = { ...board, match: { ...board.match, status: "finished" } };
      return board;
    },
  };
  return { server, api };
}

async function setup(start: Scoreboard) {
  const { server, api } = fakeServer(start);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ competitionScores: loudFake("competitionScores", api) })}>
        <ScorerPage matchId="m1" />
      </ApiProvider>
    </QueryClientProvider>
  ));
  await screen.findByRole("heading", { name: /บาสเกตบอล/ });
  return { ...view, server };
}

const scoreOf = (name: string) => screen.getByLabelText(`คะแนน ${name}`).textContent;

describe("ScorerPage", () => {
  test("big buttons come from the settings and the score moves at once", async () => {
    const { server } = await setup(boardFor(preset("basketball-5x5-male")));
    const home = screen.getByRole("region", { name: "สจล." });
    expect(
      within(home)
        .getAllByRole("button", { name: /^\+\d$/ })
        .map((b) => b.textContent),
    ).toEqual(["+1", "+2", "+3"]);
    fireEvent.click(within(home).getByRole("button", { name: "+3" }));
    expect(scoreOf("สจล.")).toBe("3");
    await waitFor(() => expect(server.sent).toHaveLength(1));
    expect(server.sent[0]?.payload).toEqual({
      type: "score",
      participantId: "home",
      points: 3,
      registrationId: null,
    });
    await waitFor(() => expect(server.board.sides[0]?.score).toBe(3));
  });

  test("undo takes back that side's last tap only", async () => {
    const { server } = await setup(boardFor(preset("basketball-5x5-male")));
    const home = screen.getByRole("region", { name: "สจล." });
    const away = screen.getByRole("region", { name: "มจธ." });
    fireEvent.click(within(home).getByRole("button", { name: "+2" }));
    fireEvent.click(within(away).getByRole("button", { name: "+1" }));
    await waitFor(() => expect(server.sent).toHaveLength(2));
    await waitFor(() => expect(server.board.events).toHaveLength(2));
    fireEvent.click(within(home).getByRole("button", { name: "ยกเลิกรายการล่าสุดของ สจล." }));
    expect(scoreOf("สจล.")).toBe("0");
    expect(scoreOf("มจธ.")).toBe("1");
    await waitFor(() => expect(server.voided).toEqual([server.sent[0]?.id]));
  });

  test("without a connection taps wait on the phone and the count shows", async () => {
    const { server } = await setup(boardFor(preset("basketball-5x5-male")));
    server.offline = true;
    const home = screen.getByRole("region", { name: "สจล." });
    fireEvent.click(within(home).getByRole("button", { name: "+2" }));
    fireEvent.click(within(home).getByRole("button", { name: "+1" }));
    expect(scoreOf("สจล.")).toBe("3");
    expect(await screen.findByText(/รอส่ง 2/)).toBeTruthy();
    expect(localStorage.getItem("it3k:score-queue:m1")).toContain("score");

    server.offline = false;
    await act(async () => {
      fireEvent.online(window);
    });
    await waitFor(() => expect(server.board.events).toHaveLength(2));
    await waitFor(() => expect(screen.queryByText(/รอส่ง/)).toBeNull());
    expect(scoreOf("สจล.")).toBe("3");
  });

  test("the shirt-number picker names who scored", async () => {
    const { server } = await setup(boardFor(preset("basketball-5x5-male")));
    fireEvent.click(screen.getByRole("checkbox"));
    const home = screen.getByRole("region", { name: "สจล." });
    fireEvent.click(within(home).getByRole("button", { name: "+2" }));
    fireEvent.click(await screen.findByRole("button", { name: /10/ }));
    await waitFor(() => expect(server.sent).toHaveLength(1));
    expect(server.sent[0]?.payload).toMatchObject({ points: 2, registrationId: "reg-10" });
  });

  test("periods move on by hand and the decided match finishes", async () => {
    const { server } = await setup(boardFor(preset("chairball-male")));
    expect(screen.getByText("ครึ่งที่ 1")).toBeTruthy();
    const home = screen.getByRole("region", { name: "สจล." });
    fireEvent.click(within(home).getByRole("button", { name: "+2" }));
    fireEvent.click(screen.getByRole("button", { name: "จบครึ่งที่ 1" }));
    fireEvent.click(screen.getByRole("button", { name: "หมดเวลาการแข่งขันปกติ" }));
    expect(await screen.findByText("ได้ผลตามกติกาแล้ว")).toBeTruthy();
    await waitFor(() => expect(server.board.events).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: "จบแมตช์" }));
    fireEvent.click(await screen.findByRole("button", { name: "ยืนยันจบแมตช์" }));
    await waitFor(() => expect(server.finishCalls).toEqual([{ force: false, version: 4 }]));
    expect(await screen.findByRole("region", { name: "ผลการแข่งขัน" })).toBeTruthy();
  });

  test("a level knockout shows shootout buttons", async () => {
    const config = preset("chairball-male");
    const start = boardFor(config);
    const events = [
      {
        id: "p2",
        seq: 1,
        payload: { type: "period" as const, period: 3 },
        voided: false,
        createdAt: 1,
      },
      {
        id: "p3",
        seq: 2,
        payload: { type: "period" as const, period: 4 },
        voided: false,
        createdAt: 2,
      },
      {
        id: "s1",
        seq: 3,
        payload: { type: "shootout" as const, participantId: "home", scored: true },
        voided: false,
        createdAt: 3,
      },
    ];
    const state = computeMatchState({
      config,
      participants: [{ id: "home" }, { id: "away" }],
      events,
    });
    await setup({ ...start, events, state });
    expect(screen.getByText("ยิงโทษ")).toBeTruthy();
    const away = screen.getByRole("region", { name: "มจธ." });
    expect(within(away).getByRole("button", { name: "ไม่เข้า" })).toBeTruthy();
  });

  test("sets show the points of the set being played", async () => {
    await setup(boardFor(preset("badminton-singles-male")));
    expect(screen.getByText("เกมที่ 1")).toBeTruthy();
    const home = screen.getByRole("region", { name: "สจล." });
    for (let i = 0; i < 3; i++) fireEvent.click(within(home).getByRole("button", { name: "+1" }));
    expect(within(home).getByLabelText("แต้มในเกมนี้").textContent).toBe("3");
  });

  test("an account without scoring rights sees why", async () => {
    const { api } = fakeServer({ ...boardFor(preset("football")), canScore: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await renderAtRoot(() => (
      <QueryClientProvider client={client}>
        <ApiProvider value={fakeApis({ competitionScores: loudFake("competitionScores", api) })}>
          <ScorerPage matchId="m1" />
        </ApiProvider>
      </QueryClientProvider>
    ));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "บัญชีนี้ไม่มีสิทธิ์ใส่คะแนน");
  });
});

describe("merging queued taps", () => {
  const score = (id: string, seq: number, participantId = "a") => ({
    id,
    seq,
    payload: { type: "score" as const, participantId, points: 1, registrationId: null },
    voided: false,
    createdAt: seq,
  });

  test("queued taps follow the server's, already-known ids once, queued undos applied", () => {
    const merged = mergeEvents(
      [score("s1", 1), score("s2", 2)],
      [
        { id: "s2", clientAt: 9, payload: score("s2", 2).payload },
        { id: "q1", clientAt: 9, payload: score("q1", 0, "b").payload },
      ],
      new Set(["s1"]),
    );
    expect(merged.map((e) => [e.id, e.seq, e.voided])).toEqual([
      ["s1", 1, true],
      ["s2", 2, false],
      ["q1", 3, false],
    ]);
    expect(lastUndoable(merged, "a")?.id).toBe("s2");
    expect(lastUndoable(merged)?.id).toBe("q1");
    expect(lastUndoable(merged, "c")).toBeNull();
  });
});
