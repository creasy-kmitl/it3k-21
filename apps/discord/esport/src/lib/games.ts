// The games the 3K Discord has a category for. Matches are played one game at
// a time, so each game keeps one set of rooms, and a team is an institution.
// `match` finds the game in what the API says about an esports registration
// (division code, division name, sport name), e.g. `esports-rov` / `ROV`.
export const GAMES = [
  { key: "rov", name: "ROV", emoji: "⚔️", match: /\brov\b|arena\s*of\s*valor/i },
  { key: "tft", name: "TFT", emoji: "♟️", match: /\btft\b|teamfight/i },
  { key: "mlbb", name: "MLBB", emoji: "🛡️", match: /\bmlbb\b|mobile\s*legends?/i },
] as const;

export type Game = (typeof GAMES)[number];
export type GameKey = Game["key"];

/** The game an esports registration is for, or undefined for one the Discord has no room for. */
export function gameOf(entry: {
  divisionCode: string;
  divisionName: string;
  sportName: string;
}): Game | undefined {
  return GAMES.find(
    (game) =>
      game.match.test(entry.divisionCode) ||
      game.match.test(entry.divisionName) ||
      game.match.test(entry.sportName),
  );
}
