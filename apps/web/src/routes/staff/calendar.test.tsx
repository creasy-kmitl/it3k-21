import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useCallback, useState } from "react";

import { ApiProvider } from "@/lib/api-context";
import { bangkokTime } from "@/lib/bangkok-time";
import type {
  CalendarApi,
  CalendarInput,
  CalendarItem,
  CalendarItemDetail,
  CalendarQuery,
  CalendarUpdate,
} from "@/lib/calendar";
import { ApiError } from "@/lib/leadership";
import {
  calendarItem,
  choose,
  defined,
  fakeApi,
  fakeCalendarApi,
  fakeUsersApi,
  renderWithQuery,
} from "@/test/query";

import { CalendarPage, type CalendarSearch } from "./calendar";

afterEach(cleanup);

function Harness({ initial }: { initial: CalendarSearch }) {
  const [search, setSearch] = useState(initial);
  const onSearch = useCallback(
    (patch: Partial<CalendarSearch>) => setSearch((previous) => ({ ...previous, ...patch })),
    [],
  );
  return <CalendarPage search={search} onSearch={onSearch} currentUserId="u-tech" />;
}

function detail(item: CalendarItem, overrides: Partial<CalendarItemDetail> = {}) {
  return {
    ...item,
    departments: [],
    actionItems: [],
    decisions: [],
    carriedOver: [],
    changes: [],
    canApprove: false,
    ...overrides,
  };
}

function setup({
  items,
  search = {},
  canCreate = true,
  api = {},
}: {
  items: CalendarItem[];
  search?: CalendarSearch;
  canCreate?: boolean;
  api?: Partial<CalendarApi>;
}) {
  const queries: CalendarQuery[] = [];
  const calendar = fakeCalendarApi({
    list: async (query) => {
      queries.push(query);
      return { items, truncated: false, canCreate, canApprove: false };
    },
    ...api,
  });
  const view = renderWithQuery(
    <ApiProvider value={{ calendar, leadership: fakeApi(), users: fakeUsersApi() }}>
      <Harness initial={{ view: "agenda", date: "2026-10-10", ...search }} />
    </ApiProvider>,
  );
  return { view, queries };
}

const agenda = () => screen.findByRole("region", { name: /10 ตุลาคม/ });

describe("/staff/calendar", () => {
  test("lists the agenda in Bangkok days with TBD and Blocked badges", async () => {
    const { queries } = setup({
      items: [
        calendarItem({ title: "VALORANT SF", tbd: true, status: "draft" }),
        calendarItem({ title: "Scoreboard v2", blockedReason: "รอ API จากฝ่ายกีฬา" }),
      ],
    });
    const day = await agenda();
    expect(within(day).getByText("VALORANT SF")).toBeTruthy();
    expect(within(day).getByText("TBD")).toBeTruthy();
    expect(within(day).getByText("Blocked")).toBeTruthy();
    // The agenda starts at midnight Bangkok time and covers two weeks.
    const main = defined(queries.find((query) => query.from === bangkokTime(2026, 9, 10)));
    expect(main.to - main.from).toBe(14 * 24 * 60 * 60 * 1000);
  });

  test("mode toggles and filters narrow the query", async () => {
    const { queries } = setup({ items: [calendarItem()] });
    await agenda();
    const modes = screen.getByRole("group", { name: "โหมด" });
    fireEvent.click(within(modes).getByRole("button", { name: /ส่งมอบงาน/ }));
    await waitFor(() => expect(queries.at(-1)?.modes).toEqual(["delivery"]));
    fireEvent.click(within(modes).getByRole("button", { name: /ปฏิบัติการ/ }));
    await waitFor(() => expect(queries.at(-1)?.modes).toEqual(["delivery", "operations"]));
    await choose(screen.getByRole("combobox", { name: "สถานะ" }), "ร่าง");
    await waitFor(() => expect(queries.at(-1)?.statuses).toEqual(["draft"]));
    fireEvent.click(within(modes).getByRole("button", { name: "ทั้งหมด" }));
    await waitFor(() => expect(queries.at(-1)?.modes).toBeUndefined());
  });

  test("readers see no way to create or edit", async () => {
    const item = calendarItem({ canEdit: false });
    setup({
      items: [item],
      canCreate: false,
      search: { item: item.id },
      api: { get: async () => detail(item) },
    });
    await screen.findByRole("heading", { name: item.title });
    expect(screen.queryByRole("button", { name: "เพิ่มรายการ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "แก้ไข" })).toBeNull();
  });

  test("creates an item with the chosen details", async () => {
    const created: CalendarInput[] = [];
    setup({
      items: [],
      api: {
        create: async (json) => {
          created.push(json);
          return calendarItem({ title: json.title });
        },
        get: async () => detail(calendarItem()),
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "เพิ่มรายการ" }));
    const form = await screen.findByRole("form", { name: "เพิ่มรายการ" });
    fireEvent.change(within(form).getByLabelText("ชื่อรายการ"), {
      target: { value: "Tech rehearsal" },
    });
    fireEvent.change(within(form).getByLabelText("แหล่งข้อมูล"), {
      target: { value: "Run sheet v3" },
    });
    fireEvent.change(within(form).getByLabelText("เริ่ม"), {
      target: { value: "2026-10-10T18:00" },
    });
    fireEvent.change(within(form).getByLabelText("สิ้นสุด"), {
      target: { value: "2026-10-10T20:00" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      title: "Tech rehearsal",
      mode: "operations",
      category: "match",
      status: "draft",
      ownerId: "u-tech",
      source: "Run sheet v3",
      startAt: bangkokTime(2026, 9, 10, 18),
      endAt: bangkokTime(2026, 9, 10, 20),
      confirm: false,
    });
  });

  test("rescheduling asks for a reason before saving", async () => {
    const item = calendarItem();
    const updates: CalendarUpdate[] = [];
    setup({
      items: [item],
      search: { item: item.id },
      api: {
        get: async () => detail(item),
        update: async (_id, json) => {
          updates.push(json);
          return item;
        },
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "แก้ไข" }));
    const form = await screen.findByRole("form", { name: "แก้ไขรายการ" });
    fireEvent.change(within(form).getByLabelText("เริ่ม"), {
      target: { value: "2026-10-10T15:00" },
    });
    fireEvent.change(within(form).getByLabelText("สิ้นสุด"), {
      target: { value: "2026-10-10T17:00" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    expect(await within(form).findByText("กรุณาบอกเหตุผลที่เลื่อนหรือยกเลิก")).toBeTruthy();
    expect(updates).toHaveLength(0);
    fireEvent.change(within(form).getByLabelText("เหตุผลที่เลื่อนหรือยกเลิก"), {
      target: { value: "ฝ่ายกีฬาเลื่อนรอบ" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toMatchObject({
      version: 1,
      reason: "ฝ่ายกีฬาเลื่อนรอบ",
      startAt: bangkokTime(2026, 9, 10, 15),
    });
  });

  test("an edit someone else saved first explains how to recover", async () => {
    const item = calendarItem();
    setup({
      items: [item],
      search: { item: item.id },
      api: {
        get: async () => detail(item),
        update: async () => {
          throw new ApiError(409, "This item changed while you were editing");
        },
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "แก้ไข" }));
    const form = await screen.findByRole("form", { name: "แก้ไขรายการ" });
    fireEvent.change(within(form).getByLabelText("ชื่อรายการ"), { target: { value: "ใหม่" } });
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    const alert = await within(form).findByRole("alert");
    expect(alert.textContent).toContain("มีคนแก้ไขรายการนี้ก่อนคุณ");
    expect(within(alert).getByRole("button", { name: "โหลดข้อมูลล่าสุด" })).toBeTruthy();
  });

  test("keeps showing the last data when a refresh fails", async () => {
    let fail = false;
    const item = calendarItem({ title: "Grand final" });
    const { view } = setup({
      items: [item],
      api: {
        list: async () => {
          if (fail) throw new ApiError(503, "down");
          return { items: [item], truncated: false, canCreate: false, canApprove: false };
        },
      },
    });
    await screen.findAllByText("Grand final");
    fail = true;
    await view.client.refetchQueries({ queryKey: ["calendar", "items"] });
    expect(await screen.findByText(/โหลดข้อมูลล่าสุดไม่สำเร็จ/)).toBeTruthy();
    expect(screen.getAllByText("Grand final").length).toBeGreaterThan(0);
  });

  test("explains in Thai why a meeting cannot be closed yet", async () => {
    const item = calendarItem({ mode: "meetings", category: "planning" });
    setup({
      items: [item],
      search: { item: item.id },
      api: {
        get: async () => detail(item),
        update: async () => {
          throw new ApiError(400, "Before closing, add agenda", {
            message: "Before closing, add agenda",
            missing: ["agenda", "decision or action item"],
          });
        },
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "แก้ไข" }));
    const form = await screen.findByRole("form", { name: "แก้ไขรายการ" });
    await choose(within(form).getByRole("combobox", { name: "สถานะ" }), "เสร็จสิ้น");
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    const alert = await within(form).findByRole("alert");
    expect(alert.textContent).toContain("ปิดรายการนี้ไม่ได้ ต้องมีวาระ");
    expect(alert.textContent).toContain("การตัดสินใจหรือ action item");
  });

  test("creates a weekly series", async () => {
    const created: CalendarInput[] = [];
    setup({
      items: [],
      api: {
        create: async (json) => {
          created.push(json);
          return calendarItem({ title: json.title });
        },
        get: async () => detail(calendarItem()),
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "เพิ่มรายการ" }));
    const form = await screen.findByRole("form", { name: "เพิ่มรายการ" });
    fireEvent.change(within(form).getByLabelText("ชื่อรายการ"), {
      target: { value: "Weekly sync" },
    });
    fireEvent.change(within(form).getByLabelText("แหล่งข้อมูล"), { target: { value: "ทีม" } });
    await choose(within(form).getByRole("combobox", { name: "ทำซ้ำ" }), "ทุกสัปดาห์");
    fireEvent.change(await within(form).findByLabelText("จำนวนครั้ง (รวมครั้งแรก)"), {
      target: { value: "3" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]?.repeat).toEqual({ every: "week", count: 3 });
  });
});
