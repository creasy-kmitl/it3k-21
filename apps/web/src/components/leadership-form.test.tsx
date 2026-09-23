import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import {
  ApiError,
  type LeadershipInput,
  type LeadershipUpdate,
  type ListQuery,
} from "@/lib/leadership";
import { fakeApi, renderWithQuery, summary } from "@/test/query";

import LeadershipForm, { type FormMode } from "./leadership-form";

afterEach(cleanup);

function setup(mode: FormMode, overrides: Parameters<typeof fakeApi>[0] = {}) {
  const created: LeadershipInput[] = [];
  const updated: [string, LeadershipUpdate][] = [];
  const searches: ListQuery[] = [];
  let done = 0;
  const api = fakeApi({
    create: async (input) => {
      created.push(input);
      return summary();
    },
    update: async (id, input) => {
      updated.push([id, input]);
      return summary();
    },
    users: async (query) => {
      searches.push(query);
      return { items: [{ id: "u-oat", name: "Oat Arthit" }], hasMore: false };
    },
    ...overrides,
  });
  const view = renderWithQuery(<LeadershipForm mode={mode} api={api} onDone={() => done++} />);
  return { view, created, updated, searches, done: () => done };
}

const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe("LeadershipForm (create)", () => {
  test("requires a name and a department", async () => {
    const { view, created } = setup({ kind: "create" });
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    expect(await view.findByText("กรุณาใส่ชื่อ")).toBeTruthy();
    expect(view.getByText("กรุณาเลือกฝ่าย")).toBeTruthy();
    expect(created).toEqual([]);
  });

  test("creates a seat with socials and blank optional fields left out", async () => {
    const { view, created, done } = setup({ kind: "create" });
    const department = view.getByLabelText("ฝ่าย");
    await waitFor(() => expect(department.querySelectorAll("option").length).toBe(3));
    type(department, "d-art");
    type(view.getByLabelText("ตำแหน่ง"), "vicehead");
    type(view.getByLabelText("ชื่อ"), " Beam ");
    type(view.getByLabelText("เบอร์โทร"), "081-234-5678");
    fireEvent.click(view.getByRole("button", { name: "เพิ่มช่องทาง" }));
    type(view.getByLabelText("แพลตฟอร์ม 1"), "line");
    type(view.getByLabelText("ช่องทาง 1"), "beam.line");
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toEqual({
      departmentId: "d-art",
      role: "vicehead",
      name: "Beam",
      nickname: null,
      phone: "081-234-5678",
      userId: null,
      socials: [{ platform: "line", value: "beam.line" }],
    });
    expect(done()).toBe(1);
  });

  test("rejects duplicate platforms and non-https links before sending", async () => {
    const { view, created } = setup({ kind: "create" });
    type(view.getByLabelText("ชื่อ"), "Beam");
    fireEvent.click(view.getByRole("button", { name: "เพิ่มช่องทาง" }));
    fireEvent.click(view.getByRole("button", { name: "เพิ่มช่องทาง" }));
    type(view.getByLabelText("แพลตฟอร์ม 1"), "line");
    type(view.getByLabelText("แพลตฟอร์ม 2"), "line");
    type(view.getByLabelText("ช่องทาง 1"), "a");
    type(view.getByLabelText("ช่องทาง 2"), "http://insecure.example");
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    expect(await view.findByText("ลิงก์ต้องขึ้นต้นด้วย https://")).toBeTruthy();
    expect(view.getByText("แต่ละแพลตฟอร์มใส่ได้ครั้งเดียว")).toBeTruthy();
    expect(created).toEqual([]);
  });

  test("searches accounts in the chosen department and attaches one", async () => {
    const { view, created, searches } = setup({ kind: "create" });
    const department = view.getByLabelText("ฝ่าย");
    await waitFor(() => expect(department.querySelectorAll("option").length).toBe(3));
    type(department, "d-art");
    type(view.getByLabelText("ชื่อ"), "Oat");
    const account = view.getByRole("combobox", { name: "บัญชีผู้ใช้" });
    fireEvent.focus(account);
    type(account, "oa");
    await waitFor(
      () => expect(searches.at(-1)).toEqual({ q: "oa", departmentId: "d-art", page: 1 }),
      {
        timeout: 3000,
      },
    );
    fireEvent.keyDown(account, { key: "ArrowDown" });
    fireEvent.click(await view.findByRole("option", { name: "Oat Arthit" }));
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created[0]?.userId).toBe("u-oat"));
  });

  test("shows the server's reason when saving fails", async () => {
    const { view } = setup(
      { kind: "create" },
      {
        create: async () => {
          throw new ApiError(409, "This department already has someone in that role");
        },
      },
    );
    const department = view.getByLabelText("ฝ่าย");
    await waitFor(() => expect(department.querySelectorAll("option").length).toBe(3));
    type(department, "d-art");
    type(view.getByLabelText("ชื่อ"), "Beam");
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    expect((await view.findByRole("alert")).textContent).toContain("already has someone");
  });
});

describe("LeadershipForm (edit)", () => {
  const seat = summary({
    id: "seat-1",
    departmentId: "d-art",
    role: "head",
    name: "Arthit",
    nickname: "โอ๊ต",
    userId: "u-oat",
    canEdit: true,
  });

  test("a manager edits seat fields without touching contact details", async () => {
    const { view, updated } = setup({ kind: "edit", seat, selfOnly: false });
    expect((view.getByLabelText("ชื่อเล่น") as HTMLInputElement).value).toBe("โอ๊ต");
    type(view.getByLabelText("ตำแหน่ง"), "vicehead");
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(updated).toHaveLength(1));
    expect(updated[0]).toEqual([
      "seat-1",
      { departmentId: "d-art", role: "vicehead", name: "Arthit", nickname: "โอ๊ต", userId: "u-oat" },
    ]);
  });

  test("a manager can detach the account", async () => {
    const { view, updated } = setup({ kind: "edit", seat, selfOnly: false });
    fireEvent.click(view.getByRole("button", { name: "ถอดบัญชี" }));
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(updated[0]?.[1]).toMatchObject({ userId: null }));
  });

  test("replacing contact details sends the full new set", async () => {
    const { view, updated } = setup({ kind: "edit", seat, selfOnly: false });
    fireEvent.click(view.getByLabelText("เปลี่ยนเบอร์โทรและช่องทางติดต่อ"));
    type(view.getByLabelText("เบอร์โทร"), "");
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(updated).toHaveLength(1));
    expect(updated[0]?.[1]).toMatchObject({ phone: null, socials: [] });
  });

  test("a leader editing their own seat can only change personal fields", async () => {
    const { view, updated } = setup({ kind: "edit", seat, selfOnly: true });
    for (const label of ["ฝ่าย", "ตำแหน่ง", "ชื่อ"]) {
      expect((view.getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
    }
    expect(view.queryByRole("combobox", { name: "บัญชีผู้ใช้" })).toBeNull();
    expect(view.queryByRole("button", { name: "ถอดบัญชี" })).toBeNull();
    type(view.getByLabelText("ชื่อเล่น"), "อาร์ต");
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(updated).toHaveLength(1));
    expect(updated[0]).toEqual(["seat-1", { nickname: "อาร์ต" }]);
  });
});
