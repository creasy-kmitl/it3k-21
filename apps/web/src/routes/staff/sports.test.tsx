import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import type { Division, Sport, SportList, SportsApi } from "@/lib/sports";
import { fakeSportsApi, renderRoute } from "@/test/query";

import { SportsPage } from "./sports";

afterEach(cleanup);

const NOW = "2026-11-14T00:00:00.000Z";

function division(overrides: Partial<Division> = {}): Division {
  return {
    id: crypto.randomUUID(),
    sportId: "s-badminton",
    code: "badminton-singles-male",
    name: "แบดมินตัน เดี่ยวชาย",
    gender: "male",
    format: "individual",
    requiresShirtNumber: false,
    requiresBadmintonRank: true,
    requiresGameProfile: false,
    maxPerInstitution: null,
    registrationOpen: true,
    sortOrder: 10,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function sport(overrides: Partial<Sport> = {}): Sport {
  return {
    id: "s-badminton",
    code: "badminton",
    name: "กีฬาแบดมินตัน",
    description: null,
    icon: "badminton",
    thumbnailUrl: null,
    sortOrder: 60,
    createdAt: NOW,
    updatedAt: NOW,
    divisions: [division()],
    ...overrides,
  };
}

function setup(list: SportList, overrides: Partial<SportsApi> = {}) {
  const api = fakeSportsApi({ list: async () => list, ...overrides });
  return renderRoute({ options: { component: SportsPage } }, { sports: api });
}

describe("/staff/sports", () => {
  test("shows sports with the generated illustration and division requirements", async () => {
    const view = setup({
      items: [
        sport({
          divisions: [
            division(),
            division({
              name: "ปิดแล้ว",
              requiresBadmintonRank: false,
              registrationOpen: false,
              maxPerInstitution: 4,
            }),
          ],
        }),
      ],
      canManage: false,
    });
    expect(await view.findByText("กีฬาแบดมินตัน")).toBeTruthy();
    expect(view.getByRole("img", { name: "กีฬาแบดมินตัน" }).tagName.toLowerCase()).toBe("svg");
    expect(view.getByText("มือ 1/2")).toBeTruthy();
    expect(view.getByLabelText("ปิดรับสมัคร")).toBeTruthy();
    expect(view.getByText("สูงสุด 4 คน/สถาบัน")).toBeTruthy();
    expect(view.queryByRole("button", { name: "เพิ่มกีฬา" })).toBeNull();
    expect(view.queryByRole("button", { name: /แก้ไข/ })).toBeNull();
  });

  test("uses the thumbnail when one is set", async () => {
    const view = setup({
      items: [sport({ thumbnailUrl: "https://cdn.test/badminton.jpg" })],
      canManage: false,
    });
    const image = await view.findByRole("img", { name: "กีฬาแบดมินตัน" });
    expect(image.getAttribute("src")).toBe("https://cdn.test/badminton.jpg");
  });

  test("managers add a sport, and invalid input is caught before sending", async () => {
    const created: unknown[] = [];
    const view = setup(
      { items: [], canManage: true },
      {
        create: async (input) => {
          created.push(input);
          return { ...sport(), ...input, description: null, thumbnailUrl: null, divisions: [] };
        },
      },
    );
    fireEvent.click(await view.findByRole("button", { name: "เพิ่มกีฬา" }));
    const dialog = within(await view.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("ชื่อ"), { target: { value: "กีฬาวอลเลย์บอล" } });
    fireEvent.change(dialog.getByLabelText("รหัส"), { target: { value: "Volley Ball" } });
    fireEvent.click(dialog.getByRole("button", { name: "บันทึก" }));
    expect(await dialog.findByText("ใช้ a-z, 0-9 และ - เท่านั้น")).toBeTruthy();
    expect(created).toEqual([]);

    fireEvent.change(dialog.getByLabelText("รหัส"), { target: { value: "volleyball" } });
    fireEvent.click(dialog.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(created).toEqual([
        {
          code: "volleyball",
          name: "กีฬาวอลเลย์บอล",
          description: "",
          icon: "general",
          thumbnailUrl: "",
          sortOrder: 0,
        },
      ]),
    );
  });

  test("managers close registration for a division", async () => {
    const updates: [string, unknown][] = [];
    const target = division({ id: "d-1" });
    const view = setup(
      { items: [sport({ divisions: [target] })], canManage: true },
      {
        updateDivision: async (id, input) => {
          updates.push([id, input]);
          return { ...target, ...input };
        },
      },
    );
    fireEvent.click(await view.findByRole("button", { name: "แก้ไข แบดมินตัน เดี่ยวชาย" }));
    const dialog = within(await view.findByRole("dialog"));
    fireEvent.click(dialog.getByRole("checkbox", { name: "เปิดรับสมัคร" }));
    fireEvent.click(dialog.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toEqual([
      "d-1",
      expect.objectContaining({ registrationOpen: false, requiresBadmintonRank: true }),
    ]);
  });

  test("shows the server's reason when a delete is refused", async () => {
    const view = setup(
      { items: [sport()], canManage: true },
      {
        remove: async () => {
          throw new Error("ลบประเภทย่อยทั้งหมดของกีฬานี้ก่อน");
        },
      },
    );
    fireEvent.click(await view.findByRole("button", { name: "ลบ กีฬาแบดมินตัน" }));
    fireEvent.click(within(await view.findByRole("alertdialog")).getByRole("button", { name: "ลบ" }));
    expect(await view.findByRole("alertdialog")).toBeTruthy();
  });
});
