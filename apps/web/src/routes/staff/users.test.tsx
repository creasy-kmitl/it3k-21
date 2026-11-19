import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import type { Account, Assignment, UsersApi } from "@/lib/users";
import { choose, defined, fakeApi, page, renderRoute, summary } from "@/test/query";

import { UsersPage } from "./users";
import { ApiError } from "@/lib/leadership";

afterEach(cleanup);

function account(overrides: Partial<Account> = {}): Account {
  return {
    storageLimit: 1073741824,
    storageUsed: 0,
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

function setup(items: Account[], canGrantAdmin = false, overrides: Partial<UsersApi> = {}) {
  const assigned: [string, Assignment][] = [];
  const api: UsersApi = {
    setStorage: async () => {
      throw new Error("Unexpected quota update");
    },
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
      return defined(items[0], "account");
    },
    setAdmin: unexpected("setAdmin"),
    ...overrides,
  };
  const seats = fakeApi({
    list: async () =>
      page([summary({ role: "head", userId: "u-old", displayName: "Old Head", name: "Old Head" })]),
  });
  return {
    assigned,
    view: renderRoute({ options: { component: UsersPage } }, { users: api, leadership: seats }),
  };
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
  test("a staff account without a department can be made a guest", async () => {
    const stray = account({ id: "u-stray", name: "Stray Staff", role: "staff" });
    const { view, assigned } = setup([stray]);
    fireEvent.click(await view.findByRole("button", { name: "แก้ไข Stray Staff" }));
    // It opens as Staff, not as the Guest it is not.
    expect(view.getByRole("combobox", { name: "สถานะ" }).textContent).toContain("Staff");
    await choose(view.getByRole("combobox", { name: "สถานะ" }), "Guest");
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(assigned).toEqual([["u-stray", { kind: "guest" }]]));
  });

  test("saving an unchanged guest sends nothing", async () => {
    const guest = account({ id: "u-guest", name: "Guest One", role: "guest" });
    const { view, assigned } = setup([guest]);
    fireEvent.click(await view.findByRole("button", { name: "แก้ไข Guest One" }));
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull());
    expect(assigned).toEqual([]);
  });

  test("retries an assignment after the quota update already succeeded", async () => {
    const guest = account({ name: "Guest One", role: "guest" });
    let persisted = guest;
    const expectedLimits: number[] = [];
    let assignments = 0;
    const { view } = setup([guest], false, {
      list: async () => ({ items: [persisted], page: 1, hasMore: false, canGrantAdmin: false }),
      setStorage: async (_id, storageLimit, expectedLimit) => {
        expectedLimits.push(expectedLimit);
        if (expectedLimit !== persisted.storageLimit) throw new ApiError(409, "stale quota");
        persisted = { ...persisted, storageLimit };
        return persisted;
      },
      assign: async () => {
        assignments++;
        if (assignments === 1) throw new Error("temporary assignment failure");
        persisted = { ...persisted, role: "athlete" };
        return persisted;
      },
    });
    fireEvent.click(await view.findByRole("button", { name: "แก้ไข Guest One" }));
    fireEvent.change(view.getByLabelText("พื้นที่จัดเก็บสูงสุด (GB)"), { target: { value: "2" } });
    await choose(view.getByRole("combobox", { name: "สถานะ" }), "นักกีฬา");
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(assignments).toBe(1));
    await waitFor(() =>
      expect(view.getByRole("button", { name: "บันทึก" })).toHaveProperty("disabled", false),
    );
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull());
    expect(assignments).toBe(2);
    expect(expectedLimits).toEqual([guest.storageLimit]);
    expect(persisted.role).toBe("athlete");
    expect(persisted.storageLimit).toBe(2 * 1024 ** 3);
  });
});
