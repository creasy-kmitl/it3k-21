import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useCallback, useState } from "react";

import { LIVE_CHECKLIST } from "@it3k/db/calendar-rules";

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
    checklist: null,
    canCheck: false,
    dependsOn: [],
    blocks: [],
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
    await pickDay(form, "เริ่ม", 10);
    await pickTime("เวลาเริ่ม", "18:00");
    await pickDay(form, "สิ้นสุด", 10);
    await pickTime("เวลาสิ้นสุด", "20:00");
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
    await pickTime("เวลาเริ่ม", "15:00");
    await pickTime("เวลาสิ้นสุด", "17:00");
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
    fireEvent.click(within(form).getByRole("button", { name: /^ทำซ้ำ/ }));
    await choose(within(form).getByRole("combobox", { name: "ทำซ้ำ" }), "ทุกสัปดาห์");
    fireEvent.change(await within(form).findByLabelText("จำนวนครั้ง (รวมครั้งแรก)"), {
      target: { value: "3" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]?.repeat).toEqual({ every: "week", count: 3 });
  });

  test("shows clashes and saves only with a mitigation", async () => {
    const attempts: CalendarInput[] = [];
    setup({
      items: [],
      api: {
        create: async (json) => {
          attempts.push(json);
          if (!json.acceptConflicts) {
            throw new ApiError(422, "This clashes", {
              message: "This clashes",
              conflicts: [
                {
                  id: "other",
                  title: "RoV SF1",
                  startAt: bangkokTime(2026, 9, 10, 18),
                  endAt: bangkokTime(2026, 9, 10, 20),
                  kinds: ["person", "venue"],
                  people: ["Tech Staff"],
                },
              ],
            });
          }
          return calendarItem({ title: json.title });
        },
        get: async () => detail(calendarItem()),
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "เพิ่มรายการ" }));
    const form = await screen.findByRole("form", { name: "เพิ่มรายการ" });
    fireEvent.change(within(form).getByLabelText("ชื่อรายการ"), { target: { value: "VAL SF1" } });
    fireEvent.change(within(form).getByLabelText("แหล่งข้อมูล"), { target: { value: "Sports" } });
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    const warning = await within(form).findByRole("alert");
    expect(warning.textContent).toContain("RoV SF1");
    expect(warning.textContent).toContain("คนเดียวกัน (Tech Staff)");
    expect(warning.textContent).toContain("สถานที่เดียวกัน");
    const accept = within(warning).getByRole("button", { name: "บันทึกทั้งที่ชน" });
    expect(accept.hasAttribute("disabled")).toBe(true);
    fireEvent.change(within(warning).getByLabelText("แผนรับมือ (ถ้าจะบันทึกทั้งที่ชน)"), {
      target: { value: "สลับคนคุม scoreboard" },
    });
    fireEvent.click(accept);
    await waitFor(() => expect(attempts).toHaveLength(2));
    expect(attempts[1]).toMatchObject({
      acceptConflicts: true,
      mitigation: "สลับคนคุม scoreboard",
    });
  });

  test("explains in Thai why an item cannot go live yet", async () => {
    const item = calendarItem();
    setup({
      items: [item],
      search: { item: item.id },
      api: {
        get: async () => detail(item),
        update: async () => {
          throw new ApiError(400, "Finish the live checklist", {
            message: "Finish the live checklist",
            missing: ["onCall", "audio"],
          });
        },
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "แก้ไข" }));
    const form = await screen.findByRole("form", { name: "แก้ไขรายการ" });
    await choose(within(form).getByRole("combobox", { name: "สถานะ" }), "Live");
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    const alert = await within(form).findByRole("alert");
    expect(alert.textContent).toContain("ยังตั้งเป็นพร้อมหรือ Live ไม่ได้");
    expect(alert.textContent).toContain("ผู้รับผิดชอบ on-call");
    expect(alert.textContent).toContain("Audio เข้า/ออก และ monitor");
  });

  test("the on-call owner ticks the live checklist", async () => {
    const item = calendarItem({ checklistDone: 1 });
    const ticks: [string, string, boolean][] = [];
    setup({
      items: [item],
      search: { item: item.id },
      api: {
        get: async () =>
          detail(item, {
            canEdit: false,
            canCheck: true,
            checklist: LIVE_CHECKLIST.map((key) => ({
              key,
              checked: key === "network",
              note: null,
              checkedAt: key === "network" ? CALENDAR_NOW : null,
              checkedBy: key === "network" ? "On Call" : null,
            })),
          }),
        check: async (id, key, json) => {
          ticks.push([id, key, json.checked]);
        },
      },
    });
    const panel = await screen.findByRole("region", { name: "Checklist ไลฟ์" });
    expect(within(panel).getByText("1/7")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("checkbox", { name: "Audio เข้า/ออก และ monitor" }));
    await waitFor(() => expect(ticks).toEqual([[item.id, "audio", true]]));
  });

  test("explains in Thai why a release cannot be released yet", async () => {
    const item = calendarItem({
      mode: "delivery",
      category: "release",
      status: "ready_to_release",
      environment: "prod",
    });
    setup({
      items: [item],
      search: { item: item.id },
      api: {
        get: async () => detail(item),
        update: async () => {
          throw new ApiError(400, "A release needs QA", {
            message: "A release needs QA",
            missing: ["qa", "approval", "dependencies"],
          });
        },
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "แก้ไข" }));
    const form = await screen.findByRole("form", { name: "แก้ไขรายการ" });
    await choose(within(form).getByRole("combobox", { name: "สถานะ" }), "Released");
    fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
    const alert = await within(form).findByRole("alert");
    expect(alert.textContent).toContain("ยังตั้งเป็น Released ไม่ได้");
    expect(alert.textContent).toContain("การอนุมัติ release");
    expect(alert.textContent).toContain("dependency ที่เสร็จครบ");
  });

  test("select options carry their icons, and so does the chosen value", async () => {
    setup({ items: [calendarItem()] });
    await agenda();
    const trigger = screen.getByRole("combobox", { name: "สถานะ" });
    fireEvent.click(trigger);
    const options = await screen.findAllByRole("option");
    const live = defined(
      options.find((option) => option.textContent === "Live"),
      "Live option",
    );
    expect(live.querySelector("svg")).not.toBeNull();
    fireEvent.pointerDown(live, { pointerType: "mouse" });
    fireEvent.click(live);
    await waitFor(() => expect(trigger.textContent).toContain("Live"));
    expect(trigger.querySelector("svg")).not.toBeNull();
  });

  describe("form sections", () => {
    async function openCreateForm(created: CalendarInput[] = []) {
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
      return screen.findByRole("form", { name: "เพิ่มรายการ" });
    }

    test("hints explain who sees notes and what blocked means", async () => {
      const form = await openCreateForm();
      fireEvent.click(within(form).getByRole("button", { name: "คำอธิบาย: โน้ตภายใน" }));
      const notes = await waitFor(() =>
        defined(document.querySelector<HTMLElement>('[data-slot="popover-content"][data-open]')),
      );
      expect(notes.textContent).toContain("เห็นเฉพาะทีมงานที่ล็อกอิน");
      expect(notes.textContent).toContain("ไม่แสดงในหน้าสาธารณะ");
      fireEvent.keyDown(notes, { key: "Escape" });

      fireEvent.click(within(form).getByRole("button", { name: /^ความเสี่ยงและการเผยแพร่/ }));
      fireEvent.click(within(form).getByRole("button", { name: "คำอธิบาย: สิ่งที่ติดขัด (Blocked)" }));
      await waitFor(() =>
        expect(
          [...document.querySelectorAll('[data-slot="popover-content"][data-open]')].some((el) =>
            el.textContent?.includes("รายการจะขึ้นป้าย Blocked"),
          ),
        ).toBe(true),
      );
    });

    test("optional sections start folded and open on request", async () => {
      const form = await openCreateForm();
      expect(within(form).queryByRole("combobox", { name: "ความเสี่ยง" })).toBeNull();
      fireEvent.click(within(form).getByRole("button", { name: /^ความเสี่ยงและการเผยแพร่/ }));
      expect(within(form).getByRole("combobox", { name: "ความเสี่ยง" })).toBeTruthy();
    });

    test("details follow the category", async () => {
      const form = await openCreateForm();
      fireEvent.click(within(form).getByRole("button", { name: /^รายละเอียดแข่งขัน/ }));
      expect(within(form).getByLabelText("ทีม")).toBeTruthy();
      expect(within(form).queryByLabelText("ลิงก์ประชุม")).toBeNull();
      expect(within(form).queryByLabelText("Pull request")).toBeNull();

      await choose(within(form).getByRole("combobox", { name: "ประเภท" }), "ถ่ายทอดสด");
      expect(within(form).queryByLabelText("ทีม")).toBeNull();
      expect(within(form).getByLabelText("แพลตฟอร์มสตรีม")).toBeTruthy();

      await choose(within(form).getByRole("combobox", { name: "โหมด" }), "ประชุม");
      expect(within(form).getByRole("button", { name: /^รายละเอียดวางแผน/ })).toBeTruthy();
    });

    test("a folded section with an invalid field opens itself on save", async () => {
      const form = await openCreateForm();
      fireEvent.change(within(form).getByLabelText("ชื่อรายการ"), { target: { value: "SF" } });
      fireEvent.change(within(form).getByLabelText("แหล่งข้อมูล"), { target: { value: "Sports" } });
      const section = within(form).getByRole("button", { name: /^รายละเอียดแข่งขัน/ });
      fireEvent.click(section);
      fireEvent.change(within(form).getByLabelText("ลิงก์ Scoreboard"), {
        target: { value: "http://insecure.example" },
      });
      fireEvent.click(section);
      // Folded fields stay mounted (so they still validate) but hidden.
      await waitFor(() =>
        expect(within(form).getByLabelText("ลิงก์ Scoreboard").closest("[hidden]")).not.toBeNull(),
      );
      fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
      expect(await within(form).findByText("มีช่องที่ต้องแก้")).toBeTruthy();
      expect(within(form).getByText("ลิงก์ต้องขึ้นต้นด้วย https://")).toBeTruthy();
      await waitFor(() =>
        expect(within(form).getByLabelText("ลิงก์ Scoreboard").closest("[hidden]")).toBeNull(),
      );
    });

    test("details that no longer apply are cleared on save", async () => {
      const created: CalendarInput[] = [];
      const form = await openCreateForm(created);
      fireEvent.change(within(form).getByLabelText("ชื่อรายการ"), { target: { value: "Sync" } });
      fireEvent.change(within(form).getByLabelText("แหล่งข้อมูล"), { target: { value: "ทีม" } });
      fireEvent.click(within(form).getByRole("button", { name: /^รายละเอียดแข่งขัน/ }));
      fireEvent.change(within(form).getByLabelText("ทีม"), { target: { value: "A, B" } });
      await choose(within(form).getByRole("combobox", { name: "โหมด" }), "ประชุม");
      fireEvent.click(within(form).getByRole("button", { name: "บันทึก" }));
      await waitFor(() => expect(created).toHaveLength(1));
      expect(created[0]).toMatchObject({
        mode: "meetings",
        category: "planning",
        teams: null,
        game: null,
        venue: null,
      });
    });
  });
});
