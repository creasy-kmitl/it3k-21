import { afterEach, beforeEach, describe, expect, test } from "bun:test";
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
  CALENDAR_NOW,
  calendarItem,
  choose,
  defined,
  fakeApi,
  fakeCalendarApi,
  fakeUsersApi,
  renderWithQuery,
} from "@/test/query";

import { CalendarPage, type CalendarSearch, parseScope, serializeScope } from "./calendar";

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

function Harness({
  initial,
  myDepartmentId,
}: {
  initial: CalendarSearch;
  myDepartmentId: string | null;
}) {
  const [search, setSearch] = useState(initial);
  const onSearch = useCallback(
    (patch: Partial<CalendarSearch>) => setSearch((previous) => ({ ...previous, ...patch })),
    [],
  );
  return (
    <CalendarPage
      search={search}
      onSearch={onSearch}
      currentUserId="u-art"
      myDepartmentId={myDepartmentId}
    />
  );
}

function detail(item: CalendarItem, overrides: Partial<CalendarItemDetail> = {}) {
  return { ...item, changes: [], ...overrides };
}

type Viewer = { canCreate?: boolean; isAdmin?: boolean };

function setup({
  items,
  search = {},
  viewer = {},
  myDepartmentId = "d-art",
  api = {},
}: {
  items: CalendarItem[];
  search?: CalendarSearch;
  viewer?: Viewer;
  myDepartmentId?: string | null;
  api?: Partial<CalendarApi>;
}) {
  const queries: CalendarQuery[] = [];
  const calendar = fakeCalendarApi({
    list: async (query) => {
      queries.push(query);
      return {
        items,
        truncated: false,
        canCreate: viewer.canCreate ?? true,
        myDepartmentId,
        isAdmin: viewer.isAdmin ?? false,
      };
    },
    ...api,
  });
  const view = renderWithQuery(
    <ApiProvider value={{ calendar, leadership: fakeApi(), users: fakeUsersApi() }}>
      <Harness
        initial={{ view: "agenda", date: "2026-10-10", ...search }}
        myDepartmentId={myDepartmentId}
      />
    </ApiProvider>,
  );
  return { view, queries };
}

/** Opens the date picker labelled `label` and picks `day` of the month it shows. */
async function pickDay(form: HTMLElement, label: string, day: number) {
  fireEvent.click(within(form).getByRole("button", { name: label }));
  const popover = await waitFor(() =>
    defined(
      document.querySelector<HTMLElement>('[data-slot="popover-content"][data-open]'),
      "open popover",
    ),
  );
  const button = [...popover.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === String(day) && !candidate.closest("[data-outside]"),
  );
  fireEvent.click(defined(button, `day ${day}`));
  // jsdom never finishes the exit animation, so wait for "closed", not removal.
  await waitFor(() =>
    expect(document.querySelector('[data-slot="popover-content"][data-open]')).toBeNull(),
  );
}

/** Opens the time picker whose label starts with `label` and picks `time` (HH:mm). */
async function pickTime(label: string, time: string) {
  const [hour, minute] = time.split(":");
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
  const popover = await waitFor(() =>
    defined(
      document.querySelector<HTMLElement>('[data-slot="popover-content"][data-open]'),
      "open popover",
    ),
  );
  fireEvent.click(
    within(within(popover).getByRole("group", { name: "ชั่วโมง" })).getByRole("button", {
      name: hour,
    }),
  );
  fireEvent.click(
    within(within(popover).getByRole("group", { name: "นาที" })).getByRole("button", {
      name: minute,
    }),
  );
  await waitFor(() =>
    expect(document.querySelector('[data-slot="popover-content"][data-open]')).toBeNull(),
  );
}

/** Opens the owner search, types `text` and picks the person shown as `name`. */
async function pickOwner(form: HTMLElement, text: string, name: string) {
  const input = within(form).getByRole("combobox", { name: "ผู้รับผิดชอบ" });
  input.focus();
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.change(input, { target: { value: text } });
  const option = await screen.findByRole("option", { name });
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.click(option);
}

const agenda = () => screen.findByRole("region", { name: /10 ตุลาคม/ });

describe("department scope", () => {
  test("parses and serializes the URL value", () => {
    expect(parseScope(undefined, "d-art")).toEqual({ kind: "mine" });
    expect(parseScope(undefined, null)).toEqual({ kind: "all" });
    expect(parseScope("all", "d-art")).toEqual({ kind: "all" });
    expect(parseScope("a,b,a", "d-art")).toEqual({ kind: "some", ids: ["a", "b"] });
    expect(serializeScope({ kind: "some", ids: ["a", "b"] })).toBe("a,b");
    expect(serializeScope({ kind: "mine" })).toBe("mine");
  });
});

describe("/staff/calendar", () => {
  test("opens on the viewer's own department and lists it by Bangkok day", async () => {
    const { queries } = setup({
      items: [
        calendarItem({ title: "ประชุมออกแบบฉาก", status: "draft" }),
        calendarItem({ title: "ติดตั้งฉาก", venue: "Hall 2" }),
      ],
    });
    const day = await agenda();
    expect(within(day).getByText("ประชุมออกแบบฉาก")).toBeTruthy();
    expect(day.textContent).toContain("Art · ร่าง");
    expect(day.textContent).toContain("Hall 2");
    expect(await screen.findByRole("heading", { name: "ปฏิทิน · Art" })).toBeTruthy();
    // The agenda starts at midnight Bangkok time, covers two weeks, and only Art.
    const main = defined(queries.find((query) => query.from === bangkokTime(2026, 9, 10)));
    expect(main.to - main.from).toBe(14 * 24 * 60 * 60 * 1000);
    expect(main.departmentIds).toEqual(["d-art"]);
  });

  test("an overnight item shows its own part of each day in the agenda", async () => {
    setup({
      items: [
        calendarItem({
          title: "ถ่ายทอดสดรอบดึก",
          startAt: bangkokTime(2026, 9, 10, 23),
          endAt: bangkokTime(2026, 9, 11, 1),
        }),
      ],
    });
    const first = await screen.findByRole("region", { name: /10 ตุลาคม/ });
    const next = screen.getByRole("region", { name: /11 ตุลาคม/ });
    expect(first.textContent).toContain("23:00–00:00");
    expect(first.textContent).toContain("ต่อถึงวันถัดไป");
    expect(next.textContent).toContain("00:00–01:00");
    expect(next.textContent).toContain("ต่อจากวันก่อน");
    expect(next.textContent).not.toContain("23:00");
  });

  test("switches to every department or a chosen few, and remembers it", async () => {
    const { queries } = setup({ items: [calendarItem()] });
    await agenda();
    const scope = screen.getByRole("group", { name: "แผนกที่แสดง" });
    fireEvent.click(within(scope).getByRole("button", { name: "ทุกแผนก" }));
    await waitFor(() => expect(queries.at(-1)?.departmentIds).toBeUndefined());
    expect(await screen.findByRole("heading", { name: "ปฏิทินทุกแผนก" })).toBeTruthy();
    expect(window.localStorage.getItem("it3k:calendar-departments")).toBe("all");

    fireEvent.click(within(scope).getByRole("button", { name: "แผนกของฉัน" }));
    await waitFor(() => expect(queries.at(-1)?.departmentIds).toEqual(["d-art"]));
    fireEvent.click(within(scope).getByRole("button", { name: /เลือกแผนก/ }));
    const tech = await screen.findByRole("menuitemcheckbox", { name: /Tech\/Live/ });
    fireEvent.click(tech);
    await waitFor(() => expect(queries.at(-1)?.departmentIds).toEqual(["d-art", "d-tech"]));
    expect(window.localStorage.getItem("it3k:calendar-departments")).toBe("d-art,d-tech");
  });

  test("reopens on the remembered scope", async () => {
    window.localStorage.setItem("it3k:calendar-departments", "d-tech");
    const { queries } = setup({ items: [] });
    await waitFor(() => expect(queries.at(-1)?.departmentIds).toEqual(["d-tech"]));
    expect(await screen.findByRole("heading", { name: "ปฏิทิน · Tech/Live" })).toBeTruthy();
  });

  test("a viewer without a department sees every department", async () => {
    const { queries } = setup({ items: [], myDepartmentId: null, viewer: { isAdmin: true } });
    await waitFor(() => expect(queries).not.toHaveLength(0));
    expect(queries.at(-1)?.departmentIds).toBeUndefined();
    const scope = screen.getByRole("group", { name: "แผนกที่แสดง" });
    expect(within(scope).queryByRole("button", { name: "แผนกของฉัน" })).toBeNull();
  });

  test("status and 'mine' filters narrow the query", async () => {
    const { queries } = setup({ items: [calendarItem()] });
    await agenda();
    await choose(screen.getByRole("combobox", { name: "สถานะ" }), "ร่าง");
    await waitFor(() => expect(queries.at(-1)?.statuses).toEqual(["draft"]));
    fireEvent.click(screen.getByRole("checkbox", { name: "เฉพาะที่ฉันรับผิดชอบ" }));
    await waitFor(() => expect(queries.at(-1)?.ownerId).toBe("u-art"));
  });

  test("readers see no way to create or edit", async () => {
    const item = calendarItem({ canEdit: false });
    setup({
      items: [item],
      viewer: { canCreate: false },
      search: { item: item.id },
      api: { get: async () => detail(item) },
    });
    await screen.findByRole("heading", { name: item.title });
    expect(screen.queryByRole("button", { name: "เพิ่มรายการ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "แก้ไข" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ลบ" })).toBeNull();
  });

  test("creates an item from just a title and times, in the viewer's department", async () => {
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
      target: { value: "ซ้อมใหญ่" },
    });
    await pickDay(form, "เริ่ม", 10);
    await pickTime("เวลาเริ่ม", "18:00");
    await pickDay(form, "สิ้นสุด", 10);
    await pickTime("เวลาสิ้นสุด", "20:00");
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toEqual({
      title: "ซ้อมใหญ่",
      departmentId: "d-art",
      status: "confirmed",
      startAt: bangkokTime(2026, 9, 10, 18),
      endAt: bangkokTime(2026, 9, 10, 20),
      venue: null,
      ownerId: null,
      notes: null,
      collaboratorIds: [],
    });
  });

  test("names the departments working on an item with the owner", async () => {
    const created: CalendarInput[] = [];
    setup({
      items: [
        calendarItem({
          title: "ลงทะเบียนนักกีฬา",
          collaborators: [
            { id: "d-tech", name: "Tech/Live", icon: "monitor-play", color: "indigo" },
          ],
        }),
      ],
      api: {
        create: async (json) => {
          created.push(json);
          return calendarItem({ title: json.title });
        },
        get: async () => detail(calendarItem()),
      },
    });
    const day = await agenda();
    expect(day.textContent).toContain("Art ร่วมกับ Tech/Live");

    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));
    const form = await screen.findByRole("form", { name: "เพิ่มรายการ" });
    fireEvent.change(within(form).getByLabelText("ชื่อรายการ"), { target: { value: "ซ้อมใหญ่" } });
    fireEvent.click(within(form).getByRole("button", { name: /รายละเอียดเพิ่มเติม/ }));
    const collaborators = within(form).getByRole("group", { name: "ฝ่ายที่ทำงานร่วมกัน" });
    // The owning department is not offered as its own collaborator.
    expect(within(collaborators).queryByRole("checkbox", { name: "Art" })).toBeNull();
    fireEvent.click(within(collaborators).getByRole("checkbox", { name: "Tech/Live" }));
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]?.collaboratorIds).toEqual(["d-tech"]);
  });

  test("the optional details are there when wanted", async () => {
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
    fireEvent.change(within(form).getByLabelText("ชื่อรายการ"), { target: { value: "นิทรรศการ" } });
    fireEvent.click(within(form).getByRole("button", { name: /รายละเอียดเพิ่มเติม/ }));
    fireEvent.change(within(form).getByLabelText("สถานที่"), { target: { value: "ห้อง 301" } });
    fireEvent.change(within(form).getByLabelText("โน้ตภายใน"), { target: { value: "ยืมขาตั้ง" } });
    await pickOwner(form, "Art", "Art Staff (Art)");
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      venue: "ห้อง 301",
      notes: "ยืมขาตั้ง",
      ownerId: "u-art",
    });
    // The calendar is for staff only: nothing is published.
    expect(created[0]).not.toHaveProperty("visibility");
  });

  test("finds an owner beyond the first page by searching on the server", async () => {
    const searched: (string | undefined)[] = [];
    const created: CalendarInput[] = [];
    const firstPage = Array.from({ length: 20 }, (_, i) => ({
      id: `u-${i}`,
      name: `Staff ${String(i).padStart(2, "0")}`,
      departmentName: "Art",
    }));
    setup({
      items: [],
      api: {
        people: async (q) => {
          searched.push(q);
          return {
            items: q ? [{ id: "u-zz", name: "Zed Late", departmentName: "PR" }] : firstPage,
          };
        },
        create: async (json) => {
          created.push(json);
          return calendarItem({ title: json.title });
        },
        get: async () => detail(calendarItem()),
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "เพิ่มรายการ" }));
    const form = await screen.findByRole("form", { name: "เพิ่มรายการ" });
    fireEvent.change(within(form).getByLabelText("ชื่อรายการ"), { target: { value: "X" } });
    fireEvent.click(within(form).getByRole("button", { name: /รายละเอียดเพิ่มเติม/ }));
    const input = within(form).getByRole("combobox", { name: "ผู้รับผิดชอบ" });
    fireEvent.click(within(form).getByRole("button", { name: "แสดงรายชื่อ" }));
    // The first page says there are more to find.
    expect(await screen.findByText("แสดง 20 คนแรก พิมพ์ชื่อเพื่อค้นหาคนอื่น")).toBeTruthy();
    await pickOwner(form, "Zed", "Zed Late (PR)");
    await waitFor(() => expect(searched).toContain("Zed"));
    expect((input as HTMLInputElement).value).toBe("Zed Late");
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created[0]?.ownerId).toBe("u-zz"));
  });

  test("an item's current owner shows in the picker and can be cleared", async () => {
    const item = calendarItem({ owner: { id: "u-far", name: "Far Away" } });
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
    const input = within(form).getByRole("combobox", { name: "ผู้รับผิดชอบ" }) as HTMLInputElement;
    expect(input.value).toBe("Far Away");
    fireEvent.click(await within(form).findByRole("button", { name: "ไม่ระบุผู้รับผิดชอบ" }));
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(updates[0]?.ownerId).toBeNull());
  });

  test("members add to their own department and nothing is published", async () => {
    setup({ items: [] });
    fireEvent.click(await screen.findByRole("button", { name: "เพิ่มรายการ" }));
    const form = await screen.findByRole("form", { name: "เพิ่มรายการ" });
    expect(within(form).queryByRole("combobox", { name: "การเผยแพร่" })).toBeNull();
    expect(form.textContent).not.toContain("สาธารณะ");
    // Members add to their own department only, so it is shown, not chosen.
    expect(within(form).queryByRole("combobox", { name: "แผนก" })).toBeNull();
  });

  test("admins choose the department", async () => {
    const created: CalendarInput[] = [];
    setup({
      items: [],
      myDepartmentId: null,
      viewer: { isAdmin: true },
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
    fireEvent.change(within(form).getByLabelText("ชื่อรายการ"), { target: { value: "X" } });
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    expect(await within(form).findByText("กรุณาเลือกแผนก")).toBeTruthy();
    await choose(within(form).getByRole("combobox", { name: "แผนก" }), "Tech/Live");
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created[0]?.departmentId).toBe("d-tech"));
  });

  test("rescheduling a confirmed item asks for a reason before saving", async () => {
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
    await pickTime("เวลาเริ่ม", "15:00");
    await pickTime("เวลาสิ้นสุด", "17:00");
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    expect(await within(form).findByText("กรุณาบอกเหตุผลที่เลื่อนหรือยกเลิก")).toBeTruthy();
    expect(updates).toHaveLength(0);
    fireEvent.change(within(form).getByLabelText("เหตุผลที่เลื่อนหรือยกเลิก"), {
      target: { value: "ห้องไม่ว่าง" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toMatchObject({
      version: 1,
      reason: "ห้องไม่ว่าง",
      startAt: bangkokTime(2026, 9, 10, 15),
    });
    expect(updates[0]).not.toHaveProperty("departmentId");
  });

  test("a draft moves without a reason", async () => {
    const item = calendarItem({ status: "draft" });
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
    await pickTime("เวลาเริ่ม", "15:00");
    await pickTime("เวลาสิ้นสุด", "17:00");
    expect(within(form).queryByLabelText("เหตุผลที่เลื่อนหรือยกเลิก")).toBeNull();
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(updates).toHaveLength(1));
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

  test("deletes only after confirming", async () => {
    const item = calendarItem({ version: 3 });
    const removed: [string, number][] = [];
    setup({
      items: [item],
      search: { item: item.id },
      api: {
        get: async () => detail(item),
        remove: async (id, version) => {
          removed.push([id, version]);
        },
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "ลบ" }));
    expect(removed).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันลบรายการ" }));
    await waitFor(() => expect(removed).toEqual([[item.id, 3]]));
  });

  test("keeps showing the last data when a refresh fails", async () => {
    let fail = false;
    const item = calendarItem({ title: "Grand final" });
    const { view } = setup({
      items: [item],
      api: {
        list: async () => {
          if (fail) throw new ApiError(503, "down");
          return {
            items: [item],
            truncated: false,
            canCreate: false,
            myDepartmentId: "d-art",
            isAdmin: false,
          };
        },
      },
    });
    await screen.findAllByText("Grand final");
    fail = true;
    await view.client.refetchQueries({ queryKey: ["calendar", "items"] });
    expect(await screen.findByText(/โหลดข้อมูลล่าสุดไม่สำเร็จ/)).toBeTruthy();
    expect(screen.getAllByText("Grand final").length).toBeGreaterThan(0);
  });

  test("status options carry their icons, and so does the chosen value", async () => {
    setup({ items: [calendarItem()] });
    await agenda();
    const trigger = screen.getByRole("combobox", { name: "สถานะ" });
    fireEvent.click(trigger);
    const options = await screen.findAllByRole("option");
    const draft = defined(
      options.find((option) => option.textContent === "ร่าง"),
      "draft option",
    );
    expect(draft.querySelector("svg")).not.toBeNull();
    fireEvent.pointerDown(draft, { pointerType: "mouse" });
    fireEvent.click(draft);
    await waitFor(() => expect(trigger.textContent).toContain("ร่าง"));
    expect(trigger.querySelector("svg")).not.toBeNull();
  });

  test("hints explain who sees notes", async () => {
    setup({ items: [] });
    fireEvent.click(await screen.findByRole("button", { name: "เพิ่มรายการ" }));
    const form = await screen.findByRole("form", { name: "เพิ่มรายการ" });
    fireEvent.click(within(form).getByRole("button", { name: /รายละเอียดเพิ่มเติม/ }));
    fireEvent.click(within(form).getByRole("button", { name: "คำอธิบาย: โน้ตภายใน" }));
    const notes = await waitFor(() =>
      defined(document.querySelector<HTMLElement>('[data-slot="popover-content"][data-open]')),
    );
    expect(notes.textContent).toContain("เห็นเฉพาะทีมงานที่ล็อกอิน");
  });

  describe("detail panel", () => {
    function open(item: CalendarItem, overrides: Partial<CalendarItemDetail> = {}) {
      const updates: CalendarUpdate[] = [];
      setup({
        items: [item],
        search: { item: item.id },
        api: {
          get: async () => detail(item, overrides),
          update: async (_id, json) => {
            updates.push(json);
            return item;
          },
        },
      });
      return updates;
    }

    test("cancelling a confirmed item needs a reason", async () => {
      const updates = open(calendarItem());
      fireEvent.click(await screen.findByRole("button", { name: "ยกเลิกรายการ" }));
      const confirm = screen.getByRole("button", { name: "ยืนยันยกเลิกรายการ" });
      expect(confirm.hasAttribute("disabled")).toBe(true);
      fireEvent.change(screen.getByLabelText("เหตุผลที่ยกเลิก"), { target: { value: "ฝนตก" } });
      fireEvent.click(confirm);
      await waitFor(() =>
        expect(updates).toEqual([{ status: "cancelled", reason: "ฝนตก", version: 1 }]),
      );
    });

    test("cancelling a draft may skip the reason", async () => {
      const updates = open(calendarItem({ status: "draft" }));
      fireEvent.click(await screen.findByRole("button", { name: "ยกเลิกรายการ" }));
      expect(screen.getByLabelText("เหตุผลที่ยกเลิก (ไม่บังคับ)")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "ยืนยันยกเลิกรายการ" }));
      await waitFor(() =>
        expect(updates).toEqual([{ status: "cancelled", reason: null, version: 1 }]),
      );
    });

    test("a draft is confirmed in one click", async () => {
      const updates = open(calendarItem({ status: "draft" }));
      fireEvent.click(await screen.findByRole("button", { name: "ยืนยันรายการ" }));
      await waitFor(() => expect(updates).toEqual([{ status: "confirmed", version: 1 }]));
    });

    test("shows the details, the collaborating departments and a readable history", async () => {
      const item = calendarItem({
        venue: "Hall 2",
        notes: "ยืมขาตั้ง",
        collaborators: [{ id: "d-tech", name: "Tech/Live", icon: "monitor-play", color: "indigo" }],
      });
      open(item, {
        changes: [
          {
            id: "c3",
            action: "update",
            changes: {
              collaboratorIds: [[], ["d-tech"]],
              status: ["draft", "confirmed"],
              ownerId: [null, "u-art"],
            },
            reason: null,
            actorUserId: "u-art",
            actorName: "Art Staff",
            createdAt: CALENDAR_NOW,
          },
          {
            id: "c2",
            // An action from before the calendar was simplified.
            action: "checklist" as never,
            changes: {},
            reason: null,
            actorUserId: "u-gone",
            actorName: null,
            createdAt: CALENDAR_NOW - 1,
          },
        ],
      });
      const details = await screen.findByText("ทำงานร่วมกับ");
      const panel = defined(details.closest("dl"));
      expect(panel.textContent).toContain("Tech/Live");
      expect(panel.textContent).toContain("Hall 2");
      expect(panel.textContent).toContain("ยืมขาตั้ง");
      const history = screen.getByRole("list", { name: "ประวัติการเปลี่ยนแปลง" });
      const rows = within(history).getAllByRole("listitem");
      const row = (label: string) => defined(rows.find((li) => li.textContent?.startsWith(label)));
      // Nothing, set and "became" are icons, with words for screen readers.
      const collaborators = row("ฝ่ายที่ทำงานร่วมกัน");
      expect(collaborators.textContent).toBe("ฝ่ายที่ทำงานร่วมกันไม่มีเป็นTech/Live");
      expect(collaborators.querySelector(".lucide-minus")).not.toBeNull();
      expect(collaborators.querySelector(".lucide-arrow-right")).not.toBeNull();
      expect(row("สถานะ").textContent).toBe("สถานะร่างเป็นยืนยันแล้ว");
      expect(row("ผู้รับผิดชอบ").querySelector(".lucide-check")).not.toBeNull();
      expect(history.textContent).toContain("checklist");
      expect(history.textContent).toContain("ผู้ใช้ที่ถูกลบ");
      expect(history.textContent).not.toMatch(/[→—✓·]/);
    });

    test("says so when the item is gone", async () => {
      const item = calendarItem();
      setup({
        items: [],
        search: { item: item.id },
        api: {
          get: async () => {
            throw new ApiError(404, "Item not found");
          },
        },
      });
      expect(await screen.findByText("ไม่พบรายการนี้")).toBeTruthy();
    });
  });

  describe("form rules", () => {
    test("an admin moving an item to a collaborator drops it from the collaborators", async () => {
      const item = calendarItem({
        collaborators: [{ id: "d-tech", name: "Tech/Live", icon: "monitor-play", color: "indigo" }],
      });
      const updates: CalendarUpdate[] = [];
      setup({
        items: [item],
        myDepartmentId: null,
        viewer: { isAdmin: true },
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
      await choose(within(form).getByRole("combobox", { name: "แผนก" }), "Tech/Live");
      fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
      await waitFor(() => expect(updates).toHaveLength(1));
      expect(updates[0]).toMatchObject({ departmentId: "d-tech", collaboratorIds: [] });
    });

    test("the collaborators already chosen stay ticked when editing", async () => {
      const item = calendarItem({
        collaborators: [{ id: "d-tech", name: "Tech/Live", icon: "monitor-play", color: "indigo" }],
      });
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
      // Folded sections open themselves when something inside is filled in.
      const group = within(form).getByRole("group", { name: "ฝ่ายที่ทำงานร่วมกัน" });
      const tech = within(group).getByRole("checkbox", { name: "Tech/Live" });
      expect(tech.getAttribute("aria-checked")).toBe("true");
      fireEvent.click(tech);
      fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
      await waitFor(() => expect(updates[0]?.collaboratorIds).toEqual([]));
    });
  });

  describe("shortcuts on right-click", () => {
    const menu = () => screen.findByRole("menu");
    const rightClick = (element: HTMLElement) =>
      fireEvent.contextMenu(element, { clientX: 10, clientY: 10 });
    const chip = async (title: string) =>
      (await screen.findAllByRole("button", { name: new RegExp(title) }))[0] as HTMLElement;

    test("open the item, straight into editing when asked", async () => {
      const item = calendarItem({ title: "ซ้อมใหญ่" });
      setup({ items: [item], api: { get: async () => detail(item) } });
      rightClick(await chip("ซ้อมใหญ่"));
      const shortcuts = await menu();
      expect(within(shortcuts).getByText("ซ้อมใหญ่")).toBeTruthy();
      fireEvent.click(within(shortcuts).getByRole("menuitem", { name: "แก้ไข" }));
      expect(await screen.findByRole("form", { name: "แก้ไขรายการ" })).toBeTruthy();
    });

    test("confirm a draft without opening it", async () => {
      const item = calendarItem({ title: "ร่างแผน", status: "draft", version: 2 });
      const updates: [string, CalendarUpdate][] = [];
      setup({
        items: [item],
        api: {
          update: async (id, json) => {
            updates.push([id, json]);
            return item;
          },
        },
      });
      rightClick(await chip("ร่างแผน"));
      fireEvent.click(within(await menu()).getByRole("menuitem", { name: "ยืนยันรายการ" }));
      await waitFor(() =>
        expect(updates).toEqual([[item.id, { status: "confirmed", version: 2 }]]),
      );
    });

    test("cancel opens its reason form in the panel", async () => {
      const item = calendarItem({ title: "ซ้อมใหญ่" });
      setup({ items: [item], api: { get: async () => detail(item) } });
      rightClick(await chip("ซ้อมใหญ่"));
      fireEvent.click(within(await menu()).getByRole("menuitem", { name: "ยกเลิกรายการ…" }));
      expect(await screen.findByLabelText("เหตุผลที่ยกเลิก")).toBeTruthy();
    });

    test("delete opens its confirmation in the panel", async () => {
      const item = calendarItem({ title: "ซ้อมใหญ่" });
      setup({ items: [item], api: { get: async () => detail(item) } });
      rightClick(await chip("ซ้อมใหญ่"));
      fireEvent.click(within(await menu()).getByRole("menuitem", { name: "ลบ…" }));
      expect(await screen.findByRole("button", { name: "ยืนยันลบรายการ" })).toBeTruthy();
    });

    test("readers get only the actions that change nothing", async () => {
      setup({ items: [calendarItem({ title: "ของฝ่ายอื่น", canEdit: false })] });
      rightClick(await chip("ของฝ่ายอื่น"));
      const shortcuts = await menu();
      const names = within(shortcuts)
        .getAllByRole("menuitem")
        .map((entry) => entry.textContent);
      expect(names).toEqual(["เปิดรายละเอียด", "ดูทั้งวัน", "เพิ่มลงปฏิทิน", "คัดลอกลิงก์"]);
    });

    test("copy a link to the item", async () => {
      const copied: string[] = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text: string) => void copied.push(text) },
      });
      const item = calendarItem({ title: "ซ้อมใหญ่" });
      setup({ items: [item] });
      rightClick(await chip("ซ้อมใหญ่"));
      fireEvent.click(within(await menu()).getByRole("menuitem", { name: "คัดลอกลิงก์" }));
      await waitFor(() => expect(copied).toHaveLength(1));
      expect(copied[0]).toContain(`/staff/calendar?view=day&date=2026-10-10&item=${item.id}`);
    });

    test("add a copy to Google Calendar from the submenu", async () => {
      const opened: string[] = [];
      const original = window.open;
      window.open = ((url: string) => {
        opened.push(url);
        return null;
      }) as typeof window.open;
      try {
        setup({ items: [calendarItem({ title: "ซ้อมใหญ่" })] });
        rightClick(await chip("ซ้อมใหญ่"));
        fireEvent.click(within(await menu()).getByRole("menuitem", { name: "เพิ่มลงปฏิทิน" }));
        fireEvent.click(await screen.findByRole("menuitem", { name: "Google Calendar" }));
        expect(opened[0]).toStartWith("https://calendar.google.com/calendar/render?");
      } finally {
        window.open = original;
      }
    });

    test("add an item on a month day at 09:00, or open the day", async () => {
      setup({ items: [], search: { view: "month" } });
      const cell = defined(
        (await screen.findByRole("button", { name: /15 ตุลาคม/ })).parentElement,
        "day cell",
      );
      rightClick(cell);
      const shortcuts = await menu();
      fireEvent.click(within(shortcuts).getByRole("menuitem", { name: "เพิ่มรายการเวลา 09:00 น." }));
      const form = await screen.findByRole("form", { name: "เพิ่มรายการ" });
      expect(within(form).getByRole("button", { name: /^เวลาเริ่ม/ }).textContent).toContain("09:00");
    });

    test("add an item at the hour under the pointer in the day view", async () => {
      setup({ items: [], search: { view: "day" } });
      const column = defined(
        (await screen.findByRole("list", { name: /10 ตุลาคม/ })).parentElement,
        "day column",
      );
      // jsdom puts every box at 0, so the pointer's y is the offset into the day.
      fireEvent.contextMenu(column, { clientX: 10, clientY: 48 * 14 + 20 });
      fireEvent.click(
        within(await menu()).getByRole("menuitem", { name: "เพิ่มรายการเวลา 14:00 น." }),
      );
      expect(await screen.findByRole("form", { name: "เพิ่มรายการ" })).toBeTruthy();
    });

    test("readers who cannot add items are only offered the day", async () => {
      setup({ items: [], search: { view: "month" }, viewer: { canCreate: false } });
      const cell = defined(
        (await screen.findByRole("button", { name: /15 ตุลาคม/ })).parentElement,
        "day cell",
      );
      rightClick(cell);
      const names = within(await menu())
        .getAllByRole("menuitem")
        .map((entry) => entry.textContent);
      expect(names).toEqual(["ดูทั้งวัน"]);
    });
  });
});
