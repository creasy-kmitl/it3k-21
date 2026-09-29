import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import type { Account, Assignment, UsersApi } from "@/lib/users";
import { choose, fakeApi, page, renderRoute, summary } from "@/test/query";

import { Route } from "./users";

afterEach(cleanup);

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: crypto.randomUUID(),
    name: "Someone",
    image: null,
    role: "staff",
    department: null,
    seatRole: null,
    canEdit: true,
    ...overrides,
  };
}

const unexpected = (name: string) => () => Promise.reject(new Error(`Unexpected call to ${name}`));

function setup(items: Account[], canGrantAdmin = false) {
  const assigned: [string, Assignment][] = [];
  const api: UsersApi = {
    me: async () => ({
      id: "me",
      role: "staff",
      department: null,
      seatRole: null,
      canManageUsers: true,
    }),
    list: async () => ({ items, page: 1, hasMore: false, canGrantAdmin }),
    assign: async (id, json) => {
      assigned.push([id, json]);
      return items[0]!;
    },
    setAdmin: unexpected("setAdmin"),
  };
  const seats = fakeApi({
    list: async () =>
      page([summary({ role: "head", userId: "u-old", displayName: "Old Head", name: "Old Head" })]),
  });
  return { assigned, view: renderRoute(Route, { users: api, leadership: seats }) };
}

describe("/staff/users", () => {
  test("shows each account's standing and only offers allowed edits", async () => {
    const { view } = setup([
      account({ name: "Guest One", role: "guest" }),
      account({ name: "Boss", role: "admin", canEdit: false }),
    ]);
    expect(await view.findByText("Guest One")).toBeTruthy();
    expect(view.getByRole("button", { name: "แก้ไข Boss" })).toHaveProperty("disabled", true);
    expect(view.queryByRole("checkbox", { name: "Admin" })).toBeNull();
  });

  test("makes a guest head of a department, warning about the current holder", async () => {
    const guest = account({ id: "u-guest", name: "Guest One", role: "guest" });
    const { view, assigned } = setup([guest]);
    fireEvent.click(await view.findByRole("button", { name: "แก้ไข Guest One" }));
    await choose(view.getByRole("combobox", { name: "สถานะ" }), "หัวหน้าฝ่าย");
    await choose(view.getByRole("combobox", { name: "ฝ่าย" }), "Art");
    expect(await view.findByText(/จะแทนที่ Old Head/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(assigned).toEqual([["u-guest", { kind: "head", departmentId: "d-art" }]]),
    );
  });
});
