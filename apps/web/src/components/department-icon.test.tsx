import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import { DEPARTMENT_ICON_KEYS, DepartmentIcon } from "./department-icon";

afterEach(cleanup);

describe("DepartmentIcon", () => {
  test("renders every known icon", () => {
    for (const icon of DEPARTMENT_ICON_KEYS) {
      const view = render(<DepartmentIcon department={{ icon, color: "red" }} />);
      expect(view.container.querySelector("svg")).not.toBeNull();
      cleanup();
    }
  });

  test("falls back to a slate folder for values it does not know", () => {
    const view = render(
      <DepartmentIcon department={{ icon: "" as never, color: "chartreuse" as never }} />,
    );
    expect(view.container.querySelector("svg.lucide-folder")).not.toBeNull();
    expect(view.container.firstElementChild?.className).toContain("bg-slate-500/15");
  });
});
