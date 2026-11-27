import { describe, expect, test } from "bun:test";
import { INSTITUTIONS } from "@it3k/db/profile";

import { GAMES, gameOf } from "./games";
import {
  CHANNELS,
  buildLayout,
  channelSlug,
  isTicketScope,
  teamChannel,
  ticketChannel,
} from "./layout";

const layout = buildLayout();
const channel = (key: string) => layout.channels.find((c) => c.key === key);

describe("layout", () => {
  test("every key is unique", () => {
    const roleKeys = layout.roles.map((r) => r.key);
    const channelKeys = layout.channels.map((c) => c.key);
    expect(new Set(roleKeys).size).toBe(roleKeys.length);
    expect(new Set(channelKeys).size).toBe(channelKeys.length);
  });

  test("every parent is a category in the layout", () => {
    for (const c of layout.channels) {
      if (!c.parent) continue;
      expect(channel(c.parent)?.kind).toBe("category");
    }
  });

  test("roles: staff, one per game, and one per game and institution", () => {
    expect(layout.roles).toHaveLength(1 + GAMES.length + GAMES.length * INSTITUTIONS.length);
    expect(layout.roles.find((r) => r.key === "team:rov:kmitl")?.name).toBe("ROV · สจล.");
  });

  test("each game has its rooms and a private team room per institution", () => {
    for (const game of GAMES) {
      const rooms = layout.channels.filter((c) => c.parent === `category:${game.key}`);
      expect(rooms.map((c) => c.kind)).toEqual([
        "text",
        "voice",
        "text",
        "text",
        ...INSTITUTIONS.map(() => "text" as const),
      ]);
      for (const institution of INSTITUTIONS) {
        expect(channel(teamChannel(game.key, institution.id))?.access).toEqual({
          everyone: "hidden",
          [`team:${game.key}:${institution.id}`]: "write",
          staff: "write",
        });
      }
    }
  });

  test("team room names have no spaces or dots", () => {
    expect(channelSlug("มจพ. กรุงเทพฯ")).toBe("มจพ-กรุงเทพฯ");
    for (const c of layout.channels.filter((c) => c.kind === "text")) {
      expect(c.name).not.toMatch(/[\s.]/);
    }
  });

  test("the staff category and its rooms are hidden from everyone", () => {
    for (const c of layout.channels.filter((c) => c.key.includes("staff"))) {
      expect(c.access.everyone).toBe("hidden");
    }
  });

  test("panels sit where the modules look for them", () => {
    expect(channel(CHANNELS.honeypot)?.panel).toBe("honeypot");
    expect(channel(CHANNELS.verify)?.panel).toBe("verify");
    expect(channel(ticketChannel("general"))?.panel).toBe("ticket:general");
    for (const game of GAMES)
      expect(channel(ticketChannel(game.key))?.panel).toBe(`ticket:${game.key}`);
    expect(isTicketScope("rov")).toBe(true);
    expect(isTicketScope("valorant")).toBe(false);
  });
});

describe("gameOf", () => {
  const entry = (divisionCode: string, divisionName = "", sportName = "กีฬา Esports") => ({
    divisionCode,
    divisionName,
    sportName,
  });

  test("finds the game from the seeded division codes and names", () => {
    expect(gameOf(entry("esports-rov", "ROV"))?.key).toBe("rov");
    expect(gameOf(entry("esports-tft", "TFT"))?.key).toBe("tft");
    expect(gameOf(entry("x", "Mobile Legends: Bang Bang"))?.key).toBe("mlbb");
    expect(gameOf(entry("esports-mlbb"))?.key).toBe("mlbb");
  });

  test("a game the Discord has no room for is undefined", () => {
    expect(gameOf(entry("esports-valorant", "Valorant"))).toBeUndefined();
    // Not a whole word: "provincial" must not read as ROV.
    expect(gameOf(entry("provincial"))).toBeUndefined();
  });
});
