import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";

import type { MyRegistration, MyRegistrations, RegistrationsApi } from "@/lib/registrations";
import type { Division, Sport } from "@/lib/sports";
import { ApiProvider } from "@/lib/api-context";
import { fakeApis, fakeRegistrationsApi, fakeSportsApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { SportsRegistrationPage, filterSports } from "./sports";
import { COMPETITION_DEFAULTS } from "@/test/divisions";

afterEach(cleanup);

const NOW = "2026-11-14T00:00:00.000Z";

function division(overrides: Partial<Division> = {}): Division {
  return {
    ...COMPETITION_DEFAULTS,
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
    studentCardFileId: null,
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
    sport: {
      id: "s-football",
      code: "football",
      name: "กีฬาฟุตบอล",
      icon: "football",
      thumbnailUrl: null,
    },
    ...overrides,
  };
}

function mine(overrides: Partial<MyRegistrations> = {}): MyRegistrations {
  return {
    profileSubmitted: true,
    institution: "kmutt",
    approvedCounts: {},
    studentId: null,
    studentCardFileId: null,
    discord: { enabled: true, linked: null },
    registrations: [],
    ...overrides,
  };
}

function setup(
  data: MyRegistrations,
  overrides: Partial<RegistrationsApi> = {},
  items: Sport[] = SPORTS,
) {
  const api = fakeRegistrationsApi({ me: async () => data, ...overrides });
  const sports = fakeSportsApi({ list: async () => ({ items, canManage: false }) });
  // The library the student card is picked from.
  const files = {
    list: async () => ({
      items: [
        {
          id: "f-new-card",
          name: "card.jpg",
          size: 100,
          contentType: "image/jpeg",
          url: "/card.jpg",
          createdAt: NOW,
        },
      ],
      uploads: [],
      page: 1,
      hasMore: false,
      used: 100,
      limit: 1024 ** 3,
    }),
    remove: async () => ({ success: true as const }),
    upload: async () => ({ id: "00000000-0000-4000-8000-000000000000" as const }),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // In a router, because the page links to /signup.
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ registrations: api, sports, files })}>
        <SportsRegistrationPage userId="u-1" />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

describe("/sports", () => {
  /** The sports to enroll in live in a drawer behind the header button. */
  async function openCatalog(view: Awaited<ReturnType<typeof setup>>, name = "สมัครกีฬา") {
    fireEvent.click(await view.findByRole("button", { name }));
    return view.findByRole("searchbox", { name: "ค้นหากีฬา" });
  }

  test("asks for the participant profile before registering", async () => {
    const view = await setup(mine({ profileSubmitted: false }));
    expect(await view.findByText("ลงทะเบียนผู้เข้าร่วมก่อน")).toBeTruthy();
    await openCatalog(view, "ดูประเภทกีฬา");
    const button = view.getByRole("button", { name: "สมัคร ฟุตบอลชาย" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // Nor a Discord bar, which is only useful once registering is possible.
    expect(view.queryByRole("button", { name: "เชื่อม Discord" })).toBeNull();
  });

  test("with nothing registered, the page points to the sports", async () => {
    const view = await setup(mine());
    expect(await view.findByText("ยังไม่ได้สมัครกีฬา")).toBeTruthy();
    expect(view.queryByRole("searchbox", { name: "ค้นหากีฬา" })).toBeNull();
    await openCatalog(view, "เลือกกีฬาที่จะสมัคร");
    expect(view.getByText("กีฬาฟุตบอล")).toBeTruthy();
  });

  test("the first registration asks for the student id, the card and the shirt number", async () => {
    const registered: unknown[] = [];
    const view = await setup(mine(), {
      register: async (json) => {
        registered.push(json);
        return registration();
      },
    });
    await openCatalog(view);
    fireEvent.click(view.getByRole("button", { name: "สมัคร ฟุตบอลชาย" }));
    fireEvent.click(await view.findByRole("button", { name: "สมัคร" }));
    expect(await view.findByText("กรอกเบอร์เสื้อ")).toBeTruthy();
    expect(view.getByText("แนบรูปบัตรนักศึกษา")).toBeTruthy();
    expect(registered).toEqual([]);

    fireEvent.change(view.getByLabelText("รหัสนักศึกษา"), { target: { value: "65070001" } });
    fireEvent.change(view.getByLabelText("เบอร์เสื้อ"), { target: { value: "7" } });
    fireEvent.click(view.getByRole("button", { name: "แนบรูปบัตรนักศึกษา" }));
    fireEvent.click(await view.findByRole("button", { name: /card\.jpg/ }));
    fireEvent.click(view.getByRole("button", { name: "ใช้รูปนี้" }));
    await waitFor(() => expect(view.getByAltText("รูปบัตรนักศึกษาที่แนบ")).toBeTruthy());
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
          studentCardFileId: "f-new-card",
        },
      ]),
    );
  });

  test("the remembered student id and card are filled in and can be changed", async () => {
    const registered: { studentId?: string; studentCardFileId?: string }[] = [];
    const view = await setup(mine({ studentId: "65070001", studentCardFileId: "f-old-card" }), {
      register: async (json) => {
        registered.push(json);
        return registration();
      },
    });
    await openCatalog(view);
    fireEvent.click(view.getByRole("button", { name: "สมัคร ฟุตบอลชาย" }));
    const dialog = await view.findByRole("dialog", { name: "สมัคร ฟุตบอลชาย" });
    const studentId = within(dialog).getByLabelText("รหัสนักศึกษา") as HTMLInputElement;
    expect(studentId.value).toBe("65070001");
    const card = within(dialog).getByAltText("รูปบัตรนักศึกษาที่แนบ") as HTMLImageElement;
    expect(card.src).toContain("f-old-card");
    expect(within(dialog).getByText(/ใช้รูปจากการสมัครครั้งก่อน/)).toBeTruthy();

    fireEvent.change(studentId, { target: { value: "65070002" } });
    fireEvent.change(within(dialog).getByLabelText("เบอร์เสื้อ"), { target: { value: "7" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "สมัคร" }));
    await waitFor(() =>
      expect(registered).toMatchObject([
        { studentId: "65070002", studentCardFileId: "f-old-card" },
      ]),
    );
  });

  test("esports needs a linked Discord account first, and only esports shows Discord", async () => {
    let linked = 0;
    const view = await setup(mine({ studentId: "65070001" }), {
      linkDiscord: async () => {
        linked++;
        return undefined as never;
      },
    });
    await openCatalog(view);
    expect(view.getByText("ต้องเชื่อม Discord ก่อนสมัคร")).toBeTruthy();
    // One bar, on the esports card; football has none.
    expect(view.getAllByRole("button", { name: "เชื่อม Discord" })).toHaveLength(1);

    fireEvent.click(view.getByRole("button", { name: "สมัคร ROV" }));
    const dialog = await view.findByRole("dialog", { name: "สมัคร ROV" });
    expect(within(dialog).getByLabelText("ชื่อภายในเกม (IGN)")).toBeTruthy();
    const submit = within(dialog).getByRole("button", { name: "สมัคร" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // The dialog links Discord itself.
    fireEvent.click(within(dialog).getByRole("button", { name: "เชื่อม Discord" }));
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
    await openCatalog(view);
    expect(view.getByText("เชื่อมแล้ว: jett")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "ยกเลิกการเชื่อม" }));
    await waitFor(() => expect(unlinked).toEqual(["a-1"]));
  });

  test("search narrows the sports and says when nothing matches", async () => {
    const view = await setup(mine());
    const search = await openCatalog(view, "เลือกกีฬาที่จะสมัคร");
    fireEvent.change(search, { target: { value: "rov" } });
    expect(view.getByText("Esports")).toBeTruthy();
    expect(view.queryByText("กีฬาฟุตบอล")).toBeNull();

    fireEvent.change(search, { target: { value: "ปิงปอง" } });
    expect(view.getByText("ไม่พบกีฬาที่ตรงกับ “ปิงปอง”")).toBeTruthy();
  });

  test("the page lists registrations: unreviewed ones can be edited or withdrawn, rejected ones show why", async () => {
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
    expect(view.getByText("การสมัครของฉัน (2)")).toBeTruthy();
    expect(view.getAllByText("เบอร์ 10")).toHaveLength(2);
    expect(view.getByText("รอตรวจสอบ")).toBeTruthy();
    expect(view.queryByRole("button", { name: "แก้ไข ROV" })).toBeNull();
    expect(view.getByRole("button", { name: "แก้ไข ฟุตบอลชาย" })).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "ถอน ฟุตบอลชาย" }));
    fireEvent.click(await view.findByRole("button", { name: "ถอน" }));
    await waitFor(() => expect(withdrawn).toEqual([["r-1", 1]]));
  });

  test("divisions with a limit show the institution's approved count; full ones still take applications", async () => {
    const limited = [
      sport({
        divisions: [
          division({ maxPerInstitution: 5 }),
          division({ id: "d-f", name: "ฟุตบอลหญิง", gender: "female", maxPerInstitution: 2 }),
        ],
      }),
    ];
    const view = await setup(mine({ approvedCounts: { "d-football": 3, "d-f": 2 } }), {}, limited);
    await openCatalog(view);
    expect(view.getByText("อนุมัติแล้ว 3/5 คน")).toBeTruthy();
    expect(view.getByText("อนุมัติครบ 2 คนแล้ว")).toBeTruthy();
    const button = view.getByRole("button", { name: "สมัคร ฟุตบอลหญิง" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  test("in the drawer, registered divisions show their status instead of a button", async () => {
    const view = await setup(mine({ studentId: "65070001", registrations: [registration()] }));
    await openCatalog(view);
    expect(view.queryByRole("button", { name: "สมัคร ฟุตบอลชาย" })).toBeNull();
    expect(view.getAllByText("รอตรวจสอบ")).toHaveLength(2);
  });
});

describe("filterSports", () => {
  const two = [
    sport({ divisions: [division(), division({ id: "d-f", name: "ฟุตบอลหญิง", gender: "female" })] }),
    SPORTS[1] as Sport,
  ];

  test("a matching sport keeps every division", () => {
    expect(filterSports(two, " ฟุตบอล ")[0]?.divisions).toHaveLength(2);
  });

  test("otherwise only the matching divisions stay", () => {
    const result = filterSports(two, "หญิง");
    expect(result.map((s) => s.id)).toEqual(["s-football"]);
    expect(result[0]?.divisions.map((d) => d.id)).toEqual(["d-f"]);
  });

  test("an empty query changes nothing", () => {
    expect(filterSports(two, "  ")).toBe(two);
  });
});
