import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import { ApiError, type ListQuery } from "@/lib/leadership";
import { choose, defined, fakeApi, page, renderWithQuery, summary } from "@/test/query";

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

  test("renders each seat as a card with an icon for its role", async () => {
    const { view } = setup(async () => page(roster));
    const art = await view.findByRole("region", { name: "Art" });
    expect(within(art).queryByRole("table")).toBeNull();
    const cards = within(art).getByRole("list", { name: "Art" }).querySelectorAll("li");
    expect(cards).toHaveLength(2);
    expect(defined(cards[0]).querySelector("svg.lucide-crown")).not.toBeNull();
    expect(defined(cards[1]).querySelector("svg.lucide-shield-user")).not.toBeNull();
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
    expect(await view.findByText("ยังไม่มีรายชื่อหัวหน้าฝ่าย")).toBeTruthy();
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

  test("shows the skeleton while the next page loads", async () => {
    let release = () => {};
    const { view } = setup((query) =>
      query.page === 1
        ? Promise.resolve(page(roster, { page: 1, hasMore: true }))
        : new Promise((resolve) => {
            release = () => resolve(page(roster, { page: query.page }));
          }),
    );
    await view.findByRole("region", { name: "Art" });
    expect(view.queryByRole("status", { name: "กำลังโหลด" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "หน้าถัดไป" }));
    expect(await view.findByText("กำลังโหลด")).toBeTruthy();
    expect(view.queryByRole("region", { name: "Art" })).toBeNull();
    release();
    await view.findByRole("region", { name: "Art" });
    expect(view.queryByText("กำลังโหลด")).toBeNull();
  });

  test("debounces search and asks the server, resetting to page 1", async () => {
    const { calls, view } = setup(async (query) =>
      page(query.q ? [defined(roster[2])] : roster, { page: query.page, hasMore: !query.q }),
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
    await waitFor(() => expect(view.queryByRole("region", { name: "Art" })).toBeNull());
  });

  test("filters by department", async () => {
    const { calls, view } = setup(async () => page(roster));
    await view.findByRole("region", { name: "Art" });
    const select = view.getByRole("combobox", { name: "ฝ่าย" });
    await choose(select, "Tech/Live");
    await waitFor(() => expect(calls.at(-1)).toMatchObject({ departmentId: "d-tech", page: 1 }));
  });

  test("the empty state follows the chosen department and search", async () => {
    const { view } = setup(async (query) => page(query.departmentId || query.q ? [] : roster));
    await view.findByRole("region", { name: "Art" });

    await choose(view.getByRole("combobox", { name: "ฝ่าย" }), "Tech/Live");
    expect(await view.findByText("ฝ่ายTech/Liveยังไม่มีหัวหน้า")).toBeTruthy();

    fireEvent.change(view.getByRole("searchbox"), { target: { value: "Zed" } });
    expect(await view.findByText("ไม่พบ “Zed” ในฝ่ายTech/Live", {}, { timeout: 3000 })).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "ดูทุกฝ่าย" }));
    expect(await view.findByText("ไม่พบ “Zed”")).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "ล้างคำค้นหา" }));
    expect(await view.findByRole("region", { name: "Art" }, { timeout: 3000 })).toBeTruthy();
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
