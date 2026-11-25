import { expect, test } from "bun:test";

import { parseRaceInput } from "./race-controls";

test("race results read as people type them", () => {
  expect(parseRaceInput("time", "10.98")).toBe(10_980);
  expect(parseRaceInput("time", "10,9")).toBe(10_900);
  expect(parseRaceInput("time", "1:02.35")).toBe(62_350);
  expect(parseRaceInput("time", "52")).toBe(52_000);
  expect(parseRaceInput("time", "1:75")).toBeNull();
  expect(parseRaceInput("time", "abc")).toBeNull();
  expect(parseRaceInput("distance", "6.45")).toBe(6_450);
  expect(parseRaceInput("distance", "6.4.5")).toBeNull();
});
