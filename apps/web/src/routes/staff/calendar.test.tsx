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

type Viewer = { canCreate?: boolean; isAdmin?: boolean; canPublishOwn?: boolean };

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
        canPublishOwn: viewer.canPublishOwn ?? false,
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

  test("the optional details and publishing are there when wanted", async () => {
    const created: CalendarInput[] = [];
    setup({
      items: [],
      viewer: { canPublishOwn: true },
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
    await choose(within(form).getByRole("combobox", { name: "ผู้รับผิดชอบ" }), "Art Staff (Art)");
    await choose(within(form).getByRole("combobox", { name: "การเผยแพร่" }), "สาธารณะ");
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      venue: "ห้อง 301",
      notes: "ยืมขาตั้ง",
      ownerId: "u-art",
      visibility: "public",
    });
  });

  test("members who cannot publish are not offered it", async () => {
    setup({ items: [] });
    fireEvent.click(await screen.findByRole("button", { name: "เพิ่มรายการ" }));
    const form = await screen.findByRole("form", { name: "เพิ่มรายการ" });
    expect(within(form).queryByRole("combobox", { name: "การเผยแพร่" })).toBeNull();
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

  test("publishers publish confirmed items from the detail panel", async () => {
    const item = calendarItem({ canPublish: true });
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
    fireEvent.click(await screen.findByRole("button", { name: "เผยแพร่สาธารณะ" }));
    await waitFor(() => expect(updates).toEqual([{ visibility: "public", version: 1 }]));
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
            canPublishOwn: false,
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
    expect(notes.textContent).toContain("ไม่แสดงในหน้าสาธารณะ");
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
      // Drafts cannot be public, so there is nothing to publish yet.
      expect(screen.queryByRole("button", { name: "เผยแพร่สาธารณะ" })).toBeNull();
    });

    test("publishers take a public item off the public calendar", async () => {
      const updates = open(calendarItem({ canPublish: true, visibility: "public" }));
      fireEvent.click(await screen.findByRole("button", { name: "เลิกเผยแพร่" }));
      await waitFor(() => expect(updates).toEqual([{ visibility: "internal", version: 1 }]));
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
            changes: { collaboratorIds: [[], ["d-tech"]], status: ["draft", "confirmed"] },
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
      expect(history.textContent).toContain("ฝ่ายที่ทำงานร่วมกัน: — → Tech/Live");
      expect(history.textContent).toContain("สถานะ: ร่าง → ยืนยันแล้ว");
      expect(history.textContent).toContain("checklist · ผู้ใช้ที่ถูกลบ");
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
    test("drafts cannot be made public", async () => {
      const created: CalendarInput[] = [];
      setup({
        items: [],
        viewer: { canPublishOwn: true },
        api: {
          create: async (json) => {
            created.push(json);
            return calendarItem();
          },
        },
      });
      fireEvent.click(await screen.findByRole("button", { name: "เพิ่มรายการ" }));
      const form = await screen.findByRole("form", { name: "เพิ่มรายการ" });
      fireEvent.change(within(form).getByLabelText("ชื่อรายการ"), { target: { value: "X" } });
      await choose(within(form).getByRole("combobox", { name: "สถานะ" }), "ร่าง");
      await choose(within(form).getByRole("combobox", { name: "การเผยแพร่" }), "สาธารณะ");
      fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
      expect(await within(form).findByText("เผยแพร่สาธารณะได้เฉพาะรายการที่ยืนยันแล้ว")).toBeTruthy();
      expect(created).toHaveLength(0);
    });

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
});
