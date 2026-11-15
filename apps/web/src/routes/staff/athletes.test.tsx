import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import type { AthleteItem, AthletePage, AthletesApi } from "@/lib/athletes";
import { choose, fakeAthletesApi, fakeSportsApi, renderRoute } from "@/test/query";

import { AthletesPage, athletesCsv } from "./athletes";

afterEach(cleanup);

const NOW = "2026-11-14T00:00:00.000Z";

function item(overrides: Partial<AthleteItem> = {}): AthleteItem {
  return {
    id: "r-1",
    userId: "u-1",
    divisionId: "d-football",
    institution: "kmutt",
    status: "review",
    shirtNumber: 10,
    badmintonRank: null,
    ign: "",
    ignReading: "",
    facebookUrl: "",
    discordUserId: null,
    discordUsername: null,
    reviewNote: null,
    reviewedBy: null,
    reviewedAt: null,
    version: 3,
    createdAt: NOW,
    updatedAt: NOW,
    division: {
      id: "d-football",
      code: "football-male",
      name: "ฟุตบอลชาย",
      gender: "male",
      format: "team",
      requiresShirtNumber: true,
      requiresBadmintonRank: false,
      requiresGameProfile: false,
    },
    sport: { id: "s-football", code: "football", name: "กีฬาฟุตบอล", icon: "football" },
    athlete: {
      userId: "u-1",
      name: "Somchai G",
      image: null,
      studentId: "65070001",
      prefix: "นาย",
      firstName: "สมชาย",
      lastName: "ใจดี",
      nickname: "ชาย",
      phone: "0812345678",
    },
    ...overrides,
  };
}

function listPage(overrides: Partial<AthletePage> = {}): AthletePage {
  return {
    items: [item()],
    page: 1,
    hasMore: false,
    scope: { kind: "institution", institution: "kmutt" },
    canReview: true,
    canEdit: false,
    canExport: true,
    ...overrides,
  };
}

function setup(data: AthletePage, overrides: Partial<AthletesApi> = {}) {
  const athletes = fakeAthletesApi({ list: async () => data, ...overrides });
  const sports = fakeSportsApi({ list: async () => ({ items: [], canManage: false }) });
  return renderRoute({ options: { component: AthletesPage } }, { athletes, sports });
}

describe("/staff/athletes", () => {
  test("another institution's staff review their own athletes but cannot edit", async () => {
    const reviewed: unknown[] = [];
    const view = setup(listPage(), {
      review: async (id, json) => {
        reviewed.push([id, json]);
        return item({ status: "approved" });
      },
    });
    expect(await view.findByText("การสมัครของ มจธ.")).toBeTruthy();
    expect(view.getByText("นายสมชาย ใจดี")).toBeTruthy();
    expect(view.getByText("รหัส 65070001")).toBeTruthy();
    expect(view.queryByRole("combobox", { name: "สถาบัน" })).toBeNull();
    expect(view.queryByRole("button", { name: /^แก้ไข/ })).toBeNull();
    expect(view.getByRole("button", { name: "ส่งออก CSV" })).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "อนุมัติ Somchai G ฟุตบอลชาย" }));
    await waitFor(() =>
      expect(reviewed).toEqual([["r-1", { status: "approved", note: "", version: 3 }]]),
    );
  });

  test("rejecting asks for a reason", async () => {
    const reviewed: unknown[] = [];
    const view = setup(listPage(), {
      review: async (id, json) => {
        reviewed.push([id, json]);
        return item({ status: "rejected" });
      },
    });
    fireEvent.click(await view.findByRole("button", { name: "ไม่อนุมัติ Somchai G ฟุตบอลชาย" }));
    const submit = await view.findByRole("button", { name: "ไม่อนุมัติ" });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(view.getByLabelText("เหตุผล").getAttribute("aria-invalid")).toBe("true"),
    );
    expect(reviewed).toEqual([]);

    fireEvent.change(view.getByLabelText("เหตุผล"), { target: { value: "เอกสารไม่ครบ" } });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(reviewed).toEqual([["r-1", { status: "rejected", note: "เอกสารไม่ครบ", version: 3 }]]),
    );
  });

  test("staff who can view only see the list, without buttons", async () => {
    const view = setup(
      listPage({
        scope: { kind: "all" },
        canReview: false,
        canEdit: false,
        canExport: false,
        items: [item({ status: "approved" })],
      }),
    );
    expect(await view.findByText("นายสมชาย ใจดี")).toBeTruthy();
    expect(view.getByText("การสมัครของทุกสถาบัน")).toBeTruthy();
    expect(view.getByRole("combobox", { name: "สถาบัน" })).toBeTruthy();
    expect(view.queryByRole("button", { name: /อนุมัติ|แก้ไข|กลับไปรอตรวจสอบ/ })).toBeNull();
    expect(view.queryByRole("button", { name: "ส่งออก CSV" })).toBeNull();
  });

  test("managers edit the student id, institution and fields", async () => {
    const edited: unknown[] = [];
    const view = setup(listPage({ scope: { kind: "all" }, canEdit: true }), {
      edit: async (id, json) => {
        edited.push([id, json]);
        return item();
      },
    });
    fireEvent.click(await view.findByRole("button", { name: "แก้ไข Somchai G ฟุตบอลชาย" }));
    fireEvent.change(view.getByLabelText("รหัสนักศึกษา"), { target: { value: "65070002" } });
    fireEvent.change(view.getByLabelText("เบอร์เสื้อ"), { target: { value: "11" } });
    await choose(view.getByRole("combobox", { name: "สถาบันของนักกีฬา" }), "สจล.");
    expect(view.getByText("ย้ายทุกการสมัครของบัญชีนี้ไปสถาบันใหม่")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(edited).toEqual([
        [
          "r-1",
          {
            shirtNumber: 11,
            badmintonRank: null,
            ign: "",
            ignReading: "",
            facebookUrl: "",
            studentId: "65070002",
            institution: "kmitl",
            version: 3,
          },
        ],
      ]),
    );
  });
});

describe("athletesCsv", () => {
  test("writes one row per registration with a header", async () => {
    const text = await athletesCsv([item({ ign: "=HYPERLINK()", status: "approved" })]).text();
    const [header, row] = text.replace(/^﻿/, "").trim().split("\r\n");
    expect(header?.split(",").slice(0, 3)).toEqual(["registration_id", "user_id", "student_id"]);
    expect(row).toContain("65070001");
    expect(row).toContain("มจธ.");
    expect(row).toContain("อนุมัติ");
    // Formula-looking text is defused so spreadsheets show it as typed.
    expect(row).toContain("'=HYPERLINK()");
  });
});
