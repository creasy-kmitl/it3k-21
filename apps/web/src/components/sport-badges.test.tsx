import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import { DivisionTags } from "./sport-badges";

afterEach(cleanup);

test("DivisionTags names the gender and the format, with one figure per player", () => {
  const pair = render(<DivisionTags division={{ gender: "female", format: "pair" }} />);
  expect(pair.getByText("หญิง")).toBeTruthy();
  expect(pair.getByText("คู่")).toBeTruthy();
  // The format's figures: two for a pair.
  expect(pair.container.querySelectorAll("[aria-hidden] > svg")).toHaveLength(2);
  cleanup();

  const team = render(<DivisionTags division={{ gender: "open", format: "team" }} />);
  expect(team.getByText("ไม่จำกัดเพศ")).toBeTruthy();
  expect(team.container.querySelectorAll("[aria-hidden] > svg")).toHaveLength(3);
});
