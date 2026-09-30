import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import type { LeadershipDepartment } from "@/lib/leadership";
import { defined } from "@/test/query";

import { type DepartmentScope, DepartmentScopePicker } from "./calendar-toolbar";

afterEach(cleanup);

const DEPARTMENTS: LeadershipDepartment[] = [
  { id: "d-art", name: "Art", icon: "palette", color: "rose" },
  { id: "d-pr", name: "PR", icon: "megaphone", color: "fuchsia" },
  { id: "d-tech", name: "Tech/Live", icon: "monitor-play", color: "indigo" },
];

function picker(scope: DepartmentScope, myDepartmentId: string | null = "d-art") {
  const changes: DepartmentScope[] = [];
  render(
    <DepartmentScopePicker
      scope={scope}
      onChange={(next) => changes.push(next)}
      departments={DEPARTMENTS}
      myDepartmentId={myDepartmentId}
    />,
  );
  return changes;
}

/** Opens the department menu, whatever its trigger says now, and ticks `name`. */
async function tick(name: string) {
  const trigger = screen
    .getAllByRole("button")
    .find((button) => button.hasAttribute("aria-haspopup"));
  fireEvent.click(defined(trigger, "menu trigger"));
  fireEvent.click(await screen.findByRole("menuitemcheckbox", { name }));
}

describe("DepartmentScopePicker", () => {
  test("marks the scope on screen", () => {
    picker({ kind: "mine" });
    const group = screen.getByRole("group", { name: "แผนกที่แสดง" });
    expect(
      within(group).getByRole("button", { name: "แผนกของฉัน" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(within(group).getByRole("button", { name: "ทุกแผนก" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  test("ticking another department adds it to the viewer's own", async () => {
    const changes = picker({ kind: "mine" });
    await tick("PR");
    expect(changes).toEqual([{ kind: "some", ids: ["d-art", "d-pr"] }]);
  });

  test("unticking the last chosen department goes back to the viewer's own", async () => {
    const changes = picker({ kind: "some", ids: ["d-pr"] });
    await tick("PR");
    expect(changes).toEqual([{ kind: "mine" }]);
  });

  test("choosing only the viewer's own department is the same as 'mine'", async () => {
    const changes = picker({ kind: "some", ids: ["d-art", "d-pr"] });
    await tick("PR");
    expect(changes).toEqual([{ kind: "mine" }]);
  });

  test("unticking one from every department keeps the rest", async () => {
    const changes = picker({ kind: "all" });
    await tick("Tech/Live");
    expect(changes).toEqual([{ kind: "some", ids: ["d-art", "d-pr"] }]);
  });

  test("without a department there is no 'mine', and an empty choice means every department", async () => {
    const changes = picker({ kind: "some", ids: ["d-pr"] }, null);
    expect(screen.queryByRole("button", { name: "แผนกของฉัน" })).toBeNull();
    expect(screen.getByRole("button", { name: /PR/ }).getAttribute("aria-pressed")).toBe("true");
    await tick("PR");
    expect(changes).toEqual([{ kind: "all" }]);
  });
});
