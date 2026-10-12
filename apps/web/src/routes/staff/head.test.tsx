import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import type { LeadershipPage } from "@/lib/leadership";
import { fakeApi, page, renderRoute, summary } from "@/test/query";

import { HeadPage } from "./head";

afterEach(cleanup);

const own = summary({ displayName: "Own", name: "Own", canEdit: true, canDelete: false });
const other = summary({
  displayName: "Other",
  name: "Other",
  departmentId: "d-tech",
  departmentName: "Tech/Live",
});
const managed = summary({
  displayName: "Managed",
  name: "Managed",
  canEdit: true,
  canDelete: true,
});

function setup(list: LeadershipPage) {
  const removed: string[] = [];
  const api = fakeApi({
    list: async () => list,
    remove: async (id) => void removed.push(id),
  });
  return { removed, view: renderRoute({ options: { component: HeadPage } }, { leadership: api }) };
}

describe("/staff/head", () => {
  test("offers contact to everyone, edit and delete only where allowed", async () => {
    const { view } = setup(page([own, other]));
    const list = within(await view.findByRole("region", { name: "Art" })).getByRole("list", {
      name: "Art",
    });
    expect(within(list).getByRole("button", { name: "ช่องทางติดต่อ Own" })).toBeTruthy();
    expect(within(list).getByRole("button", { name: "แก้ไข Own" })).toBeTruthy();
    expect(within(list).queryByRole("button", { name: "ลบ Own" })).toBeNull();
    const techList = within(view.getByRole("region", { name: "Tech/Live" })).getByRole("list", {
      name: "Tech/Live",
    });
    expect(within(techList).queryByRole("button", { name: "แก้ไข Other" })).toBeNull();
    expect(view.queryByRole("button", { name: "เพิ่มตำแหน่ง" })).toBeNull();
  });

  test("editing your own seat opens the restricted form", async () => {
    const { view } = setup(page([own]));
    const list = within(await view.findByRole("region", { name: "Art" })).getByRole("list", {
      name: "Art",
    });
    fireEvent.click(within(list).getByRole("button", { name: "แก้ไข Own" }));
    const name = (await view.findByLabelText("ชื่อ")) as HTMLInputElement;
    expect(name.disabled).toBe(true);
  });

  test("managers add seats and confirm before deleting", async () => {
    const { view, removed } = setup(page([managed], { canCreate: true }));
    fireEvent.click(await view.findByRole("button", { name: "เพิ่มตำแหน่ง" }));
    expect(((await view.findByLabelText("ชื่อ")) as HTMLInputElement).disabled).toBe(false);

    const list = within(view.getByRole("region", { name: "Art" })).getByRole("list", {
      name: "Art",
    });
    fireEvent.click(within(list).getByRole("button", { name: "ลบ Managed" }));
    const dialog = await view.findByRole("alertdialog");
    expect(removed).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "ลบ" }));
    await waitFor(() => expect(removed).toEqual([managed.id]));
  });
});
