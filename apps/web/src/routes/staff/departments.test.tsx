import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

import type { Department } from "@/lib/departments";

import { DepartmentItem } from "./departments";

afterEach(cleanup);

const department = (overrides: Partial<Department> = {}): Department => ({
  id: "d-art",
  name: "Art",
  description: null,
  code: null,
  icon: "palette",
  color: "rose",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  memberCount: 3,
  ...overrides,
});

function item(d: Department) {
  return render(
    <ul>
      <DepartmentItem
        department={d}
        canEdit
        canDelete
        onUpdate={async () => true}
        onDelete={async () => true}
      />
    </ul>,
  );
}

describe("DepartmentItem", () => {
  test("a department without a code can be edited and deleted", () => {
    const view = item(department());
    expect(view.getByRole("button", { name: "แก้ไข Art" })).toBeTruthy();
    expect(view.getByRole("button", { name: "ลบ Art" })).toBeTruthy();
  });

  test("a department with a code shows it and cannot be deleted, only edited", () => {
    const view = item(
      department({ id: "d-tech", name: "Tech/Live", code: "tech-live", icon: "monitor-play" }),
    );
    expect(view.getByText("tech-live")).toBeTruthy();
    expect(view.getByRole("button", { name: "แก้ไข Tech/Live" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "ลบ Tech/Live" })).toBeNull();
  });
});
