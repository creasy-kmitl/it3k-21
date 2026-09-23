import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import { ApiError, type ListQuery } from "@/lib/leadership";
import { fakeApi, page, renderWithQuery, summary } from "@/test/query";

import LeadershipDirectory from "./leadership-directory";

afterEach(cleanup);

const roster = [
  summary({
    departmentId: "d-art",
    departmentName: "Art",
    role: "head",
    displayName: "โอ๊ต Arthit",
  }),
  summary({ departmentId: "d-art", departmentName: "Art", role: "vicehead", displayName: "Beam" }),
  summary({
    departmentId: "d-tech",
    departmentName: "Tech/Live",
    role: "head",
    displayName: "Somchai",
  }),
];

function setup(list: (query: ListQuery) => Promise<ReturnType<typeof page>>) {
  const calls: ListQuery[] = [];
  const api = fakeApi({
    list: (query) => {
      calls.push(query);
      return list(query);
    },
  });
  return { calls, view: renderWithQuery(<LeadershipDirectory api={api} />) };
}

describe("LeadershipDirectory", () => {
  test("groups heads and viceheads by department", async () => {
    const { view } = setup(async () => page(roster));
    const art = await view.findByRole("region", { name: "Art" });
    const tech = view.getByRole("region", { name: "Tech/Live" });
    expect(within(art).getAllByText("โอ๊ต Arthit").length).toBeGreaterThan(0);
    expect(within(art).getAllByText("Beam").length).toBeGreaterThan(0);
    expect(within(art).getAllByText("รองหัวหน้าฝ่าย").length).toBeGreaterThan(0);
    expect(within(tech).getAllByText("Somchai").length).toBeGreaterThan(0);
    expect(within(tech).queryByText("Beam")).toBeNull();
  });

  test("renders a table for wide screens and cards for small ones", async () => {
    const { view } = setup(async () => page(roster));
    const art = await view.findByRole("region", { name: "Art" });
    const table = within(art).getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "ตำแหน่ง" })).toBeTruthy();
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(art).getByRole("list", { name: "Art" }).querySelectorAll("li")).toHaveLength(2);
  });

  test("shows the directory icon and title", async () => {
    const { view } = setup(async () => page([]));
    expect(view.getByRole("heading", { level: 1 }).textContent).toContain("หัวหน้าฝ่าย");
    expect(view.container.querySelector("svg.lucide-folder-kanban")).not.toBeNull();
  });

  test("never shows contact details or edit controls to staff", async () => {
    const { view } = setup(async () => page(roster));
    await view.findByRole("region", { name: "Art" });
    expect(view.queryByRole("button", { name: /แก้ไข/ })).toBeNull();
    expect(view.queryByRole("button", { name: /ลบ/ })).toBeNull();
    expect(view.queryByRole("button", { name: /เพิ่ม/ })).toBeNull();
    expect(view.container.textContent).not.toMatch(/\d{9,}/);
  });

  test("loading, empty and error states", async () => {
    let resolve: (value: ReturnType<typeof page>) => void = () => {};
    const { view } = setup(() => new Promise((r) => (resolve = r)));
    expect(view.getByRole("status").textContent).toContain("กำลังโหลด");
    resolve(page([]));
    expect(await view.findByText("ไม่พบรายชื่อ")).toBeTruthy();
    cleanup();

    const failing = setup(async () => {
      throw new ApiError(500, "Internal error");
    });
    expect((await failing.view.findByRole("alert")).textContent).toContain("Internal error");
    cleanup();

    const forbidden = setup(async () => {
      throw new ApiError(403, "Forbidden");
    });
    expect((await forbidden.view.findByRole("alert")).textContent).toContain("ไม่มีสิทธิ์");
  });

  test("debounces search and asks the server, resetting to page 1", async () => {
    const { calls, view } = setup(async (query) =>
      page(query.q ? [roster[2]!] : roster, { page: query.page, hasMore: !query.q }),
    );
    await view.findByRole("region", { name: "Art" });
    fireEvent.click(view.getByRole("button", { name: "หน้าถัดไป" }));
    await waitFor(() => expect(calls.at(-1)?.page).toBe(2));

    const search = view.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "S" } });
    fireEvent.change(search, { target: { value: "So" } });
    fireEvent.change(search, { target: { value: "Som" } });
    // Nothing is sent while the user is still typing.
    expect(calls.some((c) => c.q)).toBe(false);
    await waitFor(
      () => expect(calls.at(-1)).toEqual({ q: "Som", departmentId: undefined, page: 1 }),
      { timeout: 3000 },
    );
    expect(calls.filter((c) => c.q)).toHaveLength(1);
    expect(view.queryByRole("region", { name: "Art" })).toBeNull();
  });

  test("filters by department", async () => {
    const { calls, view } = setup(async () => page(roster));
    await view.findByRole("region", { name: "Art" });
    const select = view.getByRole("combobox", { name: "ฝ่าย" });
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(3));
    fireEvent.change(select, { target: { value: "d-tech" } });
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ departmentId: "d-tech", page: 1 }));
  });

  test("Mod+K focuses the search box", async () => {
    const { view } = setup(async () => page(roster));
    await view.findByRole("region", { name: "Art" });
    const search = view.getByRole("searchbox");
    expect(document.activeElement).not.toBe(search);
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      fireEvent.keyDown(document, { key: "k", code: "KeyK", ...modifier });
    }
    expect(document.activeElement).toBe(search);
  });
});
