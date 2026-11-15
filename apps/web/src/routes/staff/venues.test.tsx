import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import type { Venue, VenuesApi } from "@/lib/venues";
import { fakeVenuesApi, renderRoute } from "@/test/query";

import { VenuesPage, venueMapUrl } from "./venues";

afterEach(cleanup);

const NOW = "2026-11-14T00:00:00.000Z";

function venue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "v-1",
    name: "สนามฟุตบอลกลาง",
    description: null,
    latitude: 13.7299,
    longitude: 100.7782,
    externalUrl: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function setup(items: Venue[], canManage: boolean, overrides: Partial<VenuesApi> = {}) {
  const venues = fakeVenuesApi({ list: async () => ({ items, canManage }), ...overrides });
  return renderRoute({ options: { component: VenuesPage } }, { venues });
}

describe("venueMapUrl", () => {
  test("prefers the venue's own link, then its position", () => {
    expect(venueMapUrl(venue({ externalUrl: "https://maps.example/a" }))).toBe(
      "https://maps.example/a",
    );
    expect(venueMapUrl(venue())).toBe(
      "https://www.google.com/maps/search/?api=1&query=13.7299,100.7782",
    );
    expect(venueMapUrl(venue({ latitude: null, longitude: null }))).toBeNull();
  });
});

describe("/staff/venues", () => {
  test("members see venues and their map links, without edit buttons", async () => {
    const view = setup([venue()], false);
    expect(await view.findByText("สนามฟุตบอลกลาง")).toBeTruthy();
    expect(view.getByRole("link", { name: /เปิดแผนที่/ }).getAttribute("href")).toContain(
      "13.7299,100.7782",
    );
    expect(view.queryByRole("button", { name: "เพิ่มสถานที่" })).toBeNull();
    expect(view.queryByRole("button", { name: /แก้ไข/ })).toBeNull();
  });

  test("managers add a venue; a position needs both coordinates", async () => {
    const created: unknown[] = [];
    const view = setup([], true, {
      create: async (json) => {
        created.push(json);
        return venue();
      },
    });
    fireEvent.click(await view.findByRole("button", { name: "เพิ่มสถานที่" }));
    fireEvent.change(view.getByLabelText("ชื่อสถานที่"), { target: { value: "โรงยิม" } });
    fireEvent.change(view.getByLabelText("ละติจูด"), { target: { value: "13.73" } });
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    expect(await view.findByText("กรอกทั้งละติจูดและลองจิจูด หรือเว้นว่างทั้งคู่")).toBeTruthy();

    fireEvent.change(view.getByLabelText("ลองจิจูด"), { target: { value: "abc" } });
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    expect(await view.findByText("กรอกเป็นตัวเลข")).toBeTruthy();

    fireEvent.change(view.getByLabelText("ลองจิจูด"), { target: { value: "100.78" } });
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(created).toEqual([
        { name: "โรงยิม", description: "", latitude: 13.73, longitude: 100.78, externalUrl: "" },
      ]),
    );
  });

  test("managers delete a venue after confirming", async () => {
    const removed: string[] = [];
    const view = setup([venue()], true, {
      remove: async (id) => {
        removed.push(id);
        return { id };
      },
    });
    fireEvent.click(await view.findByRole("button", { name: "ลบ สนามฟุตบอลกลาง" }));
    fireEvent.click(await view.findByRole("button", { name: "ลบ" }));
    await waitFor(() => expect(removed).toEqual(["v-1"]));
  });
});
