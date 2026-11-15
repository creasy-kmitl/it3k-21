import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import type { VenueMapProps } from "@/components/venues/venue-map";
import type { Venue, VenuesApi } from "@/lib/venues";
import { fakeVenuesApi, renderRoute } from "@/test/query";

import { VenuesPage, venueMapUrl } from "./venues";

// jsdom has no WebGL, so stand in for the map: it shows what the page asked it
// to draw and offers buttons for the taps and drags a person would make.
mock.module("@/components/venues/venue-map", () => ({
  VenueMap: (props: VenueMapProps) => (
    <div data-testid="map">
      {props.venues
        .filter((venue) => venue.latitude !== null)
        .map((venue) => (
          <button key={venue.id} type="button" onClick={() => props.onSelect(venue.id)}>
            หมุด {venue.name}
          </button>
        ))}
      <button type="button" onClick={() => props.onMapClick({ lat: 13.7311, lng: 100.7801 })}>
        แตะแผนที่
      </button>
      {props.draft && (
        <>
          <span>draft {`${props.draft.lat},${props.draft.lng}`}</span>
          <button type="button" onClick={() => props.onDraftMove({ lat: 13.74, lng: 100.79 })}>
            ลากหมุดใหม่
          </button>
        </>
      )}
      {props.moving && (
        <button type="button" onClick={() => props.onMovePin({ lat: 13.75, lng: 100.8 })}>
          ลากหมุดที่ย้าย
        </button>
      )}
    </div>
  ),
}));

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
  test("members open a venue from its pin and see its map link, without edit buttons", async () => {
    const view = setup([venue()], false);
    fireEvent.click(await view.findByRole("button", { name: "หมุด สนามฟุตบอลกลาง" }));
    expect(view.getByRole("heading", { name: "สนามฟุตบอลกลาง" })).toBeTruthy();
    expect(view.getByRole("link", { name: /เปิดแผนที่/ }).getAttribute("href")).toContain(
      "13.7299,100.7782",
    );
    expect(view.queryByRole("button", { name: "เพิ่มสถานที่" })).toBeNull();
    expect(view.queryByRole("button", { name: /แก้ไข/ })).toBeNull();
  });

  test("members tapping the map drop no pin", async () => {
    const view = setup([venue()], false);
    fireEvent.click(await view.findByRole("button", { name: "แตะแผนที่" }));
    expect(view.queryByText(/^draft/)).toBeNull();
    expect(view.queryByRole("button", { name: "เพิ่มสถานที่ที่นี่" })).toBeNull();
  });

  test("the list shows venues that have no position yet", async () => {
    const view = setup([venue({ id: "v-2", name: "ห้องประชุม", latitude: null, longitude: null })], false);
    const row = await view.findByRole("button", { name: /ห้องประชุม/ });
    expect(row.textContent).toContain("ไม่มีพิกัด");
    expect(view.queryByRole("button", { name: "หมุด ห้องประชุม" })).toBeNull();
  });

  test("managers drop a pin, drag it, and add a venue there", async () => {
    const created: unknown[] = [];
    const view = setup([], true, {
      create: async (json) => {
        created.push(json);
        return venue();
      },
    });
    fireEvent.click(await view.findByRole("button", { name: "แตะแผนที่" }));
    expect(view.getByText("draft 13.7311,100.7801")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "ลากหมุดใหม่" }));
    fireEvent.click(view.getByRole("button", { name: "เพิ่มสถานที่ที่นี่" }));

    expect((view.getByLabelText("ละติจูด") as HTMLInputElement).value).toBe("13.74");
    expect((view.getByLabelText("ลองจิจูด") as HTMLInputElement).value).toBe("100.79");
    fireEvent.change(view.getByLabelText("ชื่อสถานที่"), { target: { value: "โรงยิม" } });
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(created).toEqual([
        { name: "โรงยิม", description: "", latitude: 13.74, longitude: 100.79, externalUrl: "" },
      ]),
    );
    // Saved: the draft pin is gone.
    await waitFor(() => expect(view.queryByText(/^draft/)).toBeNull());
  });

  test("managers cancel a dropped pin", async () => {
    const view = setup([], true);
    fireEvent.click(await view.findByRole("button", { name: "แตะแผนที่" }));
    fireEvent.click(view.getByRole("button", { name: "ยกเลิก" }));
    expect(view.queryByText(/^draft/)).toBeNull();
  });

  test("managers add a venue from the button; a position needs both coordinates", async () => {
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

  test("managers move a pin and keep the venue's other details", async () => {
    const updated: unknown[] = [];
    const view = setup(
      [venue({ description: "ข้างหอสมุด", externalUrl: "https://maps.example/a" })],
      true,
      {
        update: async (id, json) => {
          updated.push([id, json]);
          return venue();
        },
      },
    );
    fireEvent.click(await view.findByRole("button", { name: "หมุด สนามฟุตบอลกลาง" }));
    fireEvent.click(view.getByRole("button", { name: /ย้ายหมุด/ }));
    fireEvent.click(view.getByRole("button", { name: "ลากหมุดที่ย้าย" }));
    fireEvent.click(view.getByRole("button", { name: /บันทึกตำแหน่ง/ }));
    await waitFor(() =>
      expect(updated).toEqual([
        [
          "v-1",
          {
            name: "สนามฟุตบอลกลาง",
            description: "ข้างหอสมุด",
            latitude: 13.75,
            longitude: 100.8,
            externalUrl: "https://maps.example/a",
          },
        ],
      ]),
    );
  });

  test("managers place a first pin for a venue without a position by tapping the map", async () => {
    const updated: unknown[] = [];
    const view = setup([venue({ latitude: null, longitude: null })], true, {
      update: async (id, json) => {
        updated.push([id, json]);
        return venue();
      },
    });
    fireEvent.click(await view.findByRole("button", { name: /สนามฟุตบอลกลาง/ }));
    fireEvent.click(view.getByRole("button", { name: /ปักหมุด$/ }));
    const saveButton = view.getByRole("button", { name: /บันทึกตำแหน่ง/ }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "แตะแผนที่" }));
    fireEvent.click(view.getByRole("button", { name: /บันทึกตำแหน่ง/ }));
    await waitFor(() =>
      expect(updated).toEqual([
        [
          "v-1",
          {
            name: "สนามฟุตบอลกลาง",
            description: "",
            latitude: 13.7311,
            longitude: 100.7801,
            externalUrl: "",
          },
        ],
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
    fireEvent.click(await view.findByRole("button", { name: "หมุด สนามฟุตบอลกลาง" }));
    fireEvent.click(view.getByRole("button", { name: "ลบ สนามฟุตบอลกลาง" }));
    fireEvent.click(await view.findByRole("button", { name: "ลบ" }));
    await waitFor(() => expect(removed).toEqual(["v-1"]));
  });
});
