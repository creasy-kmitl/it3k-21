import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";

import { MatchStatusBadge } from "./match-status-badge";

describe("MatchStatusBadge", () => {
  test("shows the status in Thai", () => {
    render(<MatchStatusBadge status="live" />);
    expect(screen.getByText("กำลังแข่ง")).toBeTruthy();
  });
});
