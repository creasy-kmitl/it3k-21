import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import type { MyRegistration, MyRegistrations, RegistrationsApi } from "@/lib/registrations";
import type { Division, Sport } from "@/lib/sports";
import { ApiProvider } from "@/lib/api-context";
import { fakeApis, fakeRegistrationsApi, fakeSportsApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { SportsRegistrationPage } from "./sports";

afterEach(cleanup);

const NOW = "2026-11-14T00:00:00.000Z";

function division(overrides: Partial<Division> = {}): Division {
  return {
    id: "d-football",
    sportId: "s-football",
    code: "football-male",
    name: "ฟุตบอลชาย",
    gender: "male",
    format: "team",
    requiresShirtNumber: true,
    requiresBadmintonRank: false,
    requiresGameProfile: false,
    maxPerInstitution: null,
    registrationOpen: true,
    sortOrder: 10,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const ROV = division({
  id: "d-rov",
  sportId: "s-esports",
  code: "esports-rov",
  name: "ROV",
  gender: "open",
  requiresShirtNumber: false,
  requiresGameProfile: true,
});

function sport(overrides: Partial<Sport> = {}): Sport {
  return {
    id: "s-football",
    code: "football",
    name: "กีฬาฟุตบอล",
    description: null,
    icon: "football",
    thumbnailUrl: null,
    sortOrder: 10,
    createdAt: NOW,
    updatedAt: NOW,
    divisions: [division()],
    ...overrides,
  };
}

const SPORTS = [
  sport(),
  sport({ id: "s-esports", code: "esports", name: "Esports", icon: "esports", divisions: [ROV] }),
];

function registration(overrides: Partial<MyRegistration> = {}): MyRegistration {
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
    version: 1,
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
    ...overrides,
  };
}

function mine(overrides: Partial<MyRegistrations> = {}): MyRegistrations {
  return {
    profileSubmitted: true,
    institution: "kmutt",
    studentId: null,
    discord: { enabled: true, linked: null },
    registrations: [],
    ...overrides,
  };
}

function setup(data: MyRegistrations, overrides: Partial<RegistrationsApi> = {}) {
  const api = fakeRegistrationsApi({ me: async () => data, ...overrides });
  const sports = fakeSportsApi({ list: async () => ({ items: SPORTS, canManage: false }) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // In a router, because the page links to /signup.
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ registrations: api, sports })}>
        <SportsRegistrationPage />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

describe("/sports", () => {
  test("asks for the participant profile before registering", async () => {
    const view = await setup(mine({ profileSubmitted: false }));
    expect(await view.findByText("ลงทะเบียนผู้เข้าร่วมก่อน")).toBeTruthy();
    const button = view.getByRole("button", { name: "สมัคร ฟุตบอลชาย" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  test("the first registration asks for the student id and the shirt number", async () => {
    const registered: unknown[] = [];
    const view = await setup(mine(), {
      register: async (json) => {
        registered.push(json);
        return registration();
      },
    });
    fireEvent.click(await view.findByRole("button", { name: "สมัคร ฟุตบอลชาย" }));
    fireEvent.click(view.getByRole("button", { name: "สมัคร" }));
    expect(await view.findByText("กรอกเบอร์เสื้อ")).toBeTruthy();
    expect(registered).toEqual([]);

    fireEvent.change(view.getByLabelText("รหัสนักศึกษา"), { target: { value: "65070001" } });
    fireEvent.change(view.getByLabelText("เบอร์เสื้อ"), { target: { value: "7" } });
    fireEvent.click(view.getByRole("button", { name: "สมัคร" }));
    await waitFor(() =>
      expect(registered).toEqual([
        {
          shirtNumber: 7,
          badmintonRank: null,
          ign: "",
          ignReading: "",
          facebookUrl: "",
          divisionId: "d-football",
          studentId: "65070001",
        },
      ]),
    );
  });

  test("esports needs a linked Discord account first", async () => {
    let linked = 0;
    const view = await setup(mine({ studentId: "65070001" }), {
      linkDiscord: async () => {
        linked++;
        return undefined as never;
      },
    });
    expect(await view.findByText(/ต้องเชื่อม Discord ก่อนสมัครกีฬา Esports/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "สมัคร ROV" }));
    expect(view.queryByLabelText("รหัสนักศึกษา")).toBeNull();
    expect(view.getByLabelText("ชื่อภายในเกม (IGN)")).toBeTruthy();
    const submit = view.getByRole("button", { name: "สมัคร" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "ยกเลิก" }));

    fireEvent.click(view.getByRole("button", { name: "เชื่อม Discord" }));
    await waitFor(() => expect(linked).toBe(1));
  });

  test("a linked Discord account can be unlinked", async () => {
    const unlinked: string[] = [];
    const view = await setup(
      mine({
        discord: { enabled: true, linked: { accountId: "a-1", userId: "123", username: "jett" } },
      }),
      {
        unlinkDiscord: async (accountId) => {
          unlinked.push(accountId);
          return undefined as never;
        },
      },
    );
    expect(await view.findByText("เชื่อมแล้ว: jett")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "ยกเลิกการเชื่อม" }));
    await waitFor(() => expect(unlinked).toEqual(["a-1"]));
  });

  test("lists registrations: unreviewed ones can be edited or withdrawn, rejected ones show why", async () => {
    const withdrawn: [string, number][] = [];
    const view = await setup(
      mine({
        studentId: "65070001",
        registrations: [
          registration(),
          registration({
            id: "r-2",
            divisionId: "d-rov",
            status: "rejected",
            reviewNote: "ไม่ใช่นักศึกษา",
            division: { ...registration().division, id: "d-rov", name: "ROV" },
          }),
        ],
      }),
      {
        withdraw: async (id, version) => {
          withdrawn.push([id, version]);
          return { id };
        },
      },
    );
    expect(await view.findByText("เหตุผล: ไม่ใช่นักศึกษา")).toBeTruthy();
    expect(view.getAllByText("เบอร์ 10")).toHaveLength(2);
    expect(view.getAllByText("สมัครแล้ว")).toHaveLength(2);
    expect(view.queryByRole("button", { name: "แก้ไข ROV" })).toBeNull();
    expect(view.getByRole("button", { name: "แก้ไข ฟุตบอลชาย" })).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "ถอน ฟุตบอลชาย" }));
    fireEvent.click(await view.findByRole("button", { name: "ถอน" }));
    await waitFor(() => expect(withdrawn).toEqual([["r-1", 1]]));
  });
});
