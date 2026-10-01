import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { ApiProvider } from "@/lib/api-context";
import { ApiError } from "@/lib/leadership";
import type {
  LinksApi,
  LinksQuery,
  ShortLink,
  ShortLinkDetail,
  ShortLinkInput,
  ShortLinkUpdate,
} from "@/lib/links";
import { defined, fakeApis, fakeLinksApi, shortLink } from "@/test/query";

import { LinksPage } from "@/components/links/links-page";
import type { QrBrowser } from "@/lib/qr-export";
import { strFromU8, unzipSync } from "fflate";

import { Route } from "./links";

afterEach(cleanup);

function detail(link: ShortLink, overrides: Partial<ShortLinkDetail> = {}): ShortLinkDetail {
  return {
    ...link,
    daily: Array.from({ length: 30 }, (_, i) => ({
      day: `2026-09-${String(i + 1).padStart(2, "0")}`,
      qr: i === 29 ? 4 : 0,
      link: i === 29 ? 1 : 0,
    })),
    changes: [
      {
        id: "c1",
        action: "create",
        changes: {},
        actorUserId: "u-art",
        actorName: "Art Staff",
        createdAt: link.createdAt,
      },
    ],
    ...overrides,
  };
}

/** The links page in a memory router, so its links to QR Studio can be followed. */
async function setup(
  items: ShortLink[],
  api: Partial<LinksApi> = {},
  canCreate = true,
  tags: string[] = [],
) {
  const queries: LinksQuery[] = [];
  const details: [string, number | undefined][] = [];
  const created: ShortLinkInput[] = [];
  const updated: [string, ShortLinkUpdate][] = [];
  const links = fakeLinksApi({
    list: async (query = {}) => {
      queries.push(query);
      return { items, truncated: false, tags, canCreate, canManageAll: false };
    },
    get: async (id, days) => {
      details.push([id, days]);
      return detail(
        defined(
          items.find((link) => link.id === id),
          "link",
        ),
      );
    },
    create: async (json) => {
      created.push(json);
      const link = shortLink({ id: "new", title: json.title, destination: json.destination });
      items.unshift(link);
      return link;
    },
    update: async (id, json) => {
      updated.push([id, json]);
      return defined(items.find((link) => link.id === id));
    },
    ...api,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const downloads: { name: string; blob: Blob }[] = [];
  const browser: QrBrowser = {
    rasterize: async (_svg, type) => new Blob(["png"], { type }),
    download: (blob, name) => void downloads.push({ blob, name }),
    copyPng: async () => true,
    copyText: async () => true,
    loadLogo: async () => "data:image/png;base64,AAAA",
  };
  // The route's page, with a browser that records downloads.
  defined(Route.options.component, "links page");
  const Page = () => <LinksPage browser={browser} />;
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <ApiProvider value={fakeApis({ links })}>
          <Outlet />
        </ApiProvider>
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/staff/links", component: Page }),
      createRoute({
        getParentRoute: () => root,
        path: "/staff/qr-code",
        component: () => <p>qr studio</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/staff/links"] }),
  });
  await act(() => router.load());
  const view = render(<RouterProvider router={router} />);
  return { view, router, queries, created, updated, details, links, downloads };
}

const drawer = () =>
  defined(document.querySelector<HTMLElement>('[data-slot="drawer-content"]'), "open drawer");

describe("/staff/links", () => {
  test("lists links with their state and visits", async () => {
    const { view } = await setup([
      shortLink({ title: "ลงทะเบียน", visits: { qr: 12, link: 3 } }),
      shortLink({ title: "ตารางแข่ง", slug: "schedule", state: "disabled", enabled: false }),
    ]);
    const list = await view.findByRole("list", { name: "ลิงก์สั้น" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]?.textContent).toContain("ลงทะเบียน");
    expect(rows[0]?.textContent).toContain("it3k.test/l/register");
    expect(rows[0]?.textContent).toContain("ใช้งานอยู่");
    expect(rows[0]?.textContent).toContain("12");
    expect(rows[1]?.textContent).toContain("ปิดอยู่");
  });

  test("offers to make the first link when there are none", async () => {
    const { view } = await setup([]);
    expect(await view.findByText("ยังไม่มีลิงก์สั้น")).toBeTruthy();
    expect(view.getByRole("button", { name: "สร้างลิงก์แรก" })).toBeTruthy();
  });

  test("filters to the viewer's own links", async () => {
    const { view, queries } = await setup([shortLink()]);
    await view.findByRole("list", { name: "ลิงก์สั้น" });
    fireEvent.click(view.getByRole("button", { name: "ของฉัน" }));
    await waitFor(() => expect(queries.at(-1)).toEqual({ q: "", mine: true }));
  });

  test("creates a link with a random slug, then opens it", async () => {
    const { view, created } = await setup([]);
    fireEvent.click(await view.findByRole("button", { name: "สร้างลิงก์แรก" }));
    const form = drawer();
    fireEvent.change(within(form).getByLabelText("ชื่อลิงก์"), {
      target: { value: "ฟอร์มสมัคร" },
    });
    fireEvent.change(within(form).getByLabelText("ปลายทาง"), {
      target: { value: "https://forms.example.com/a" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "สร้างลิงก์" }));
    await waitFor(() =>
      expect(created).toEqual([{ title: "ฟอร์มสมัคร", destination: "https://forms.example.com/a" }]),
    );
    expect(await view.findByText("ลิงก์สำหรับ QR")).toBeTruthy();
  });

  test("refuses an unsafe destination before sending it", async () => {
    const { view, created } = await setup([]);
    fireEvent.click(await view.findByRole("button", { name: "สร้างลิงก์แรก" }));
    const form = drawer();
    fireEvent.change(within(form).getByLabelText("ชื่อลิงก์"), { target: { value: "x" } });
    fireEvent.change(within(form).getByLabelText("ปลายทาง"), {
      target: { value: "http://example.com" },
    });
    fireEvent.change(within(form).getByLabelText("ชื่อท้ายลิงก์ (ไม่บังคับ)"), {
      target: { value: "-bad" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "สร้างลิงก์" }));
    expect(await within(form).findByText(/ต้องขึ้นต้นด้วย https/)).toBeTruthy();
    expect(within(form).getByText(/ห้ามขึ้นต้นหรือลงท้ายด้วยขีด/)).toBeTruthy();
    expect(created).toEqual([]);
  });

  test("says in Thai when a slug is taken", async () => {
    const { view } = await setup([], {
      create: async () => {
        throw new ApiError(409, "That short name is already in use", {
          code: "slug-taken",
          field: "slug",
        });
      },
    });
    fireEvent.click(await view.findByRole("button", { name: "สร้างลิงก์แรก" }));
    const form = drawer();
    fireEvent.change(within(form).getByLabelText("ชื่อลิงก์"), { target: { value: "x" } });
    fireEvent.change(within(form).getByLabelText("ปลายทาง"), {
      target: { value: "https://example.com" },
    });
    fireEvent.change(within(form).getByLabelText("ชื่อท้ายลิงก์ (ไม่บังคับ)"), {
      target: { value: "Register" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "สร้างลิงก์" }));
    expect((await within(form).findByRole("alert")).textContent).toContain("มีคนใช้แล้ว");
  });
});

describe("tags, UTM and the fallback", () => {
  test("creates a link with tags, UTM on the destination and a fallback", async () => {
    const { view, created } = await setup([], {}, true, ["valorant"]);
    fireEvent.click(await view.findByRole("button", { name: "สร้างลิงก์แรก" }));
    const form = drawer();
    fireEvent.change(within(form).getByLabelText("ชื่อลิงก์"), { target: { value: "ฟอร์ม" } });
    fireEvent.change(within(form).getByLabelText("ปลายทาง"), {
      target: { value: "https://forms.example.com/a" },
    });
    fireEvent.click(within(form).getByRole("button", { name: /UTM สำหรับติดตามแคมเปญ/ }));
    fireEvent.change(await within(form).findByLabelText("มาจากที่ไหน (source)"), {
      target: { value: "poster" },
    });
    fireEvent.change(within(form).getByLabelText("แคมเปญ (campaign)"), {
      target: { value: "it3k-21" },
    });
    // What is typed goes straight into the URL.
    expect((within(form).getByLabelText("ปลายทาง") as HTMLInputElement).value).toBe(
      "https://forms.example.com/a?utm_source=poster&utm_campaign=it3k-21",
    );
    fireEvent.change(within(form).getByLabelText("ปลายทางสำรอง (ไม่บังคับ)"), {
      target: { value: "https://it3k.example/event" },
    });
    const tags = within(form).getByLabelText("แท็ก (ไม่บังคับ)");
    fireEvent.change(tags, { target: { value: "Valorant Finals" } });
    fireEvent.keyDown(tags, { key: "Enter" });
    fireEvent.change(tags, { target: { value: "pr" } });
    fireEvent.keyDown(tags, { key: "," });
    fireEvent.click(within(form).getByRole("button", { name: "เอาแท็ก pr ออก" }));
    fireEvent.click(within(form).getByRole("button", { name: "สร้างลิงก์" }));
    await waitFor(() =>
      expect(created).toEqual([
        {
          title: "ฟอร์ม",
          destination: "https://forms.example.com/a?utm_source=poster&utm_campaign=it3k-21",
          fallbackUrl: "https://it3k.example/event",
          tags: ["valorant-finals"],
        },
      ]),
    );
  });

  test("an unsafe fallback is refused before sending", async () => {
    const { view, created } = await setup([]);
    fireEvent.click(await view.findByRole("button", { name: "สร้างลิงก์แรก" }));
    const form = drawer();
    fireEvent.change(within(form).getByLabelText("ชื่อลิงก์"), { target: { value: "x" } });
    fireEvent.change(within(form).getByLabelText("ปลายทาง"), {
      target: { value: "https://example.com" },
    });
    fireEvent.change(within(form).getByLabelText("ปลายทางสำรอง (ไม่บังคับ)"), {
      target: { value: "http://example.com" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "สร้างลิงก์" }));
    expect(await within(form).findByText(/ต้องขึ้นต้นด้วย https/)).toBeTruthy();
    expect(created).toEqual([]);
  });

  test("filters by a tag, and clears it with a second click", async () => {
    const { view, queries } = await setup([shortLink({ tags: ["rov"] })], {}, true, ["rov", "pr"]);
    const filter = await view.findByRole("group", { name: "กรองตามแท็ก" });
    fireEvent.click(within(filter).getByRole("button", { name: "rov" }));
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ tag: "rov" }));
    fireEvent.click(within(filter).getByRole("button", { name: "rov" }));
    await waitFor(() => expect(queries.at(-1)?.tag).toBeUndefined());
  });
});

describe("a link's panel", () => {
  test("charts another range on request", async () => {
    const link = shortLink({ title: "ลงทะเบียน" });
    const { view, details } = await setup([link]);
    fireEvent.click(await view.findByRole("button", { name: "ลงทะเบียน" }));
    const panel = drawer();
    const ranges = await within(panel).findByRole("group", { name: "ช่วงเวลา" });
    fireEvent.click(within(ranges).getByRole("button", { name: "90 วัน" }));
    await waitFor(() => expect(details.at(-1)).toEqual([link.id, 90]));
  });

  test("shows the fallback, marked in use while the link is off", async () => {
    const link = shortLink({
      title: "ลงทะเบียน",
      state: "disabled",
      enabled: false,
      fallbackUrl: "https://it3k.example/event",
    });
    const { view } = await setup([link]);
    fireEvent.click(await view.findByRole("button", { name: "ลงทะเบียน" }));
    const panel = drawer();
    expect(await within(panel).findByText("it3k.example/event")).toBeTruthy();
    expect(within(panel).getByText("ใช้อยู่ตอนนี้")).toBeTruthy();
  });

  test("shows both URLs, the visits and a way into QR Studio", async () => {
    const link = shortLink({ title: "ลงทะเบียน", visits: { qr: 40, link: 9 } });
    const { view, router } = await setup([link]);
    fireEvent.click(await view.findByRole("button", { name: "ลงทะเบียน" }));
    const panel = drawer();
    expect(await within(panel).findByText("it3k.test/l/register?qr")).toBeTruthy();
    expect(within(panel).getByText("it3k.test/l/register")).toBeTruthy();
    expect(within(panel).getByRole("img").getAttribute("aria-label")).toBe(
      "30 วันล่าสุด เปิดผ่าน QR 4 ครั้ง ผ่านลิงก์ 1 ครั้ง",
    );
    expect(within(panel).getByText("40")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("link", { name: "ออกแบบ QR จากลิงก์นี้" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/staff/qr-code"));
    expect(router.state.location.search).toEqual({ text: link.qrUrl });
  });

  test("switching a link off asks first", async () => {
    const link = shortLink({ title: "ลงทะเบียน", version: 3 });
    const { view, updated } = await setup([link]);
    fireEvent.click(await view.findByRole("button", { name: "ลงทะเบียน" }));
    const panel = drawer();
    fireEvent.click(await within(panel).findByRole("button", { name: "ปิดลิงก์" }));
    expect(updated).toEqual([]);
    const confirm = within(panel).getByRole("alert");
    expect(confirm.textContent).toContain("หน้าแจ้งว่าลิงก์ถูกปิด");
    fireEvent.click(within(confirm).getByRole("button", { name: "ปิดลิงก์" }));
    await waitFor(() => expect(updated).toEqual([[link.id, { enabled: false, version: 3 }]]));
  });

  test("edits the destination", async () => {
    const link = shortLink({ title: "ลงทะเบียน" });
    const { view, updated } = await setup([link]);
    fireEvent.click(await view.findByRole("button", { name: "ลงทะเบียน" }));
    const panel = drawer();
    fireEvent.click(await within(panel).findByRole("button", { name: "แก้ไข" }));
    // The slug is printed in QR codes, so it cannot be edited.
    expect(within(panel).queryByLabelText("ชื่อท้ายลิงก์ (ไม่บังคับ)")).toBeNull();
    fireEvent.change(within(panel).getByLabelText("ปลายทาง"), {
      target: { value: "https://forms.example.com/v2" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(updated).toEqual([
        [
          link.id,
          {
            title: "ลงทะเบียน",
            destination: "https://forms.example.com/v2",
            expiresAt: null,
            fallbackUrl: null,
            tags: [],
            version: 1,
          },
        ],
      ]),
    );
  });

  test("someone else's link is read-only", async () => {
    const { view } = await setup([shortLink({ title: "ของคนอื่น", canEdit: false })]);
    fireEvent.click(await view.findByRole("button", { name: "ของคนอื่น" }));
    const panel = drawer();
    await within(panel).findByText("ลิงก์สำหรับ QR");
    expect(within(panel).queryByRole("button", { name: "แก้ไข" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "ปิดลิงก์" })).toBeNull();
  });
});

// ignoreBOM keeps the byte-order mark in the text, so a test can see it.
const text = async (blob: Blob) =>
  new TextDecoder("utf-8", { ignoreBOM: true }).decode(await blob.arrayBuffer());

describe("passwords", () => {
  test("creates a locked link, refusing a password that is too short", async () => {
    const { view, created } = await setup([]);
    fireEvent.click(await view.findByRole("button", { name: "สร้างลิงก์แรก" }));
    const form = drawer();
    fireEvent.change(within(form).getByLabelText("ชื่อลิงก์"), { target: { value: "ลับ" } });
    fireEvent.change(within(form).getByLabelText("ปลายทาง"), {
      target: { value: "https://forms.example.com/staff" },
    });
    fireEvent.click(within(form).getByRole("checkbox", { name: "ต้องใส่รหัสผ่านก่อนเปิดลิงก์" }));
    const password = await within(form).findByLabelText("รหัสผ่านของลิงก์");
    // Hidden while typed, shown on request.
    expect(password.getAttribute("type")).toBe("password");
    expect(password.getAttribute("autocomplete")).toBe("new-password");
    fireEvent.click(within(form).getByRole("button", { name: "แสดงรหัสผ่าน" }));
    expect(password.getAttribute("type")).toBe("text");
    fireEvent.change(password, { target: { value: "abc" } });
    fireEvent.click(within(form).getByRole("button", { name: "สร้างลิงก์" }));
    expect(await within(form).findByText("รหัสผ่านยาว 4–64 ตัวอักษร")).toBeTruthy();
    expect(created).toEqual([]);
    fireEvent.change(password, { target: { value: "tech2026" } });
    fireEvent.click(within(form).getByRole("button", { name: "สร้างลิงก์" }));
    await waitFor(() =>
      expect(created).toEqual([
        { title: "ลับ", destination: "https://forms.example.com/staff", password: "tech2026" },
      ]),
    );
  });

  test("a locked link says so, and its password can be removed", async () => {
    const link = shortLink({ title: "ลับ", hasPassword: true });
    const { view, updated } = await setup([link]);
    fireEvent.click(await view.findByRole("button", { name: "ลับ" }));
    const panel = drawer();
    expect(await within(panel).findByText("มีรหัสผ่าน")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "แก้ไข" }));
    expect(within(panel).getByText("ลิงก์นี้ต้องใส่รหัสผ่านก่อนเปิด")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "เอารหัสออก" }));
    fireEvent.click(within(panel).getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(updated).toHaveLength(1));
    expect(updated[0]?.[1]).toMatchObject({ password: null });
  });
});

describe("many links at once", () => {
  const pasted = [
    "title\tdestination\tslug\ttags",
    "บูธ ROV\thttps://forms.example.com/rov\tbooth-rov\tbooth|rov",
    "บูธ Valo\thttp://forms.example.com/valo\t\tbooth",
  ].join("\n");

  async function openBulk(view: Awaited<ReturnType<typeof setup>>["view"]) {
    fireEvent.click(await view.findByRole("button", { name: "วิธีสร้างลิงก์อื่น" }));
    fireEvent.click(await view.findByRole("menuitem", { name: "สร้างหลายลิงก์จากตาราง" }));
    return drawer();
  }

  test("checks pasted rows, creates them all, then zips their QR codes", async () => {
    const bulk: unknown[] = [];
    const { view, downloads } = await setup([shortLink()], {
      bulk: async (rows) => {
        bulk.push(rows);
        return {
          items: rows.map((row, i) =>
            shortLink({ id: `n${i}`, title: row.title, slug: row.slug ?? `rnd${i}` }),
          ),
        };
      },
    });
    const panel = await openBulk(view);
    fireEvent.change(within(panel).getByLabelText("หรือวางจาก Google Sheets หรือ Excel"), {
      target: { value: pasted },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "ตรวจรายการ" }));
    expect((await within(panel).findByRole("alert")).textContent).toContain("มีปัญหา 1 จาก 2 แถว");
    expect(within(panel).getByRole("button", { name: "สร้าง 2 ลิงก์" })).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.click(within(panel).getByRole("button", { name: "แก้รายการ" }));
    fireEvent.change(within(panel).getByLabelText("หรือวางจาก Google Sheets หรือ Excel"), {
      target: { value: pasted.replace("http://", "https://") },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "ตรวจรายการ" }));
    expect((await within(panel).findByRole("status")).textContent).toContain("พร้อมสร้าง 2 ลิงก์");
    fireEvent.click(within(panel).getByRole("button", { name: "สร้าง 2 ลิงก์" }));
    expect(await within(panel).findByText("สร้าง 2 ลิงก์แล้ว")).toBeTruthy();
    expect(bulk).toEqual([
      [
        {
          title: "บูธ ROV",
          destination: "https://forms.example.com/rov",
          slug: "booth-rov",
          tags: ["booth", "rov"],
        },
        { title: "บูธ Valo", destination: "https://forms.example.com/valo", tags: ["booth"] },
      ],
    ]);

    fireEvent.click(within(panel).getByRole("button", { name: "ดาวน์โหลด QR 2 อัน (.zip)" }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]?.name).toBe("it3k-qr-2-links.zip");
    const files = unzipSync(new Uint8Array(await defined(downloads[0]).blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["booth-rov.png", "links.csv", "rnd1.png"]);
    expect(strFromU8(defined(files["links.csv"]))).toContain("booth-rov.png");
  });

  test("shows the API's refusals on their rows", async () => {
    const { view } = await setup([shortLink()], {
      bulk: async () => {
        throw new ApiError(409, "Some rows cannot be created", {
          code: "rows",
          rows: [{ index: 0, code: "slug-taken", field: "slug" }],
        });
      },
    });
    const panel = await openBulk(view);
    fireEvent.change(within(panel).getByLabelText("หรือวางจาก Google Sheets หรือ Excel"), {
      target: { value: pasted.replace("http://", "https://") },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "ตรวจรายการ" }));
    fireEvent.click(await within(panel).findByRole("button", { name: "สร้าง 2 ลิงก์" }));
    expect(await within(panel).findByText("ชื่อลิงก์นี้มีคนใช้แล้ว ลองชื่ออื่น")).toBeTruthy();
    expect(within(panel).getByRole("alert").textContent).toContain("มีปัญหา 1 จาก 2 แถว");
  });
});

describe("exports", () => {
  async function exportMenu(view: Awaited<ReturnType<typeof setup>>["view"], item: RegExp) {
    fireEvent.click(await view.findByRole("button", { name: "ส่งออก" }));
    fireEvent.click(await view.findByRole("menuitem", { name: item }));
  }

  test("the shown links as a spreadsheet Excel reads as Thai", async () => {
    const { view, downloads } = await setup([shortLink({ title: "บูธ, ROV", tags: ["a", "b"] })]);
    await exportMenu(view, /รายการลิงก์/);
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]?.name).toBe("it3k-links.csv");
    const csv = await text(defined(downloads[0]).blob);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('"บูธ, ROV",register,https://it3k.test/l/register');
    expect(csv).toContain("a|b");
  });

  test("daily visits for the current tag over 90 days", async () => {
    const asked: unknown[] = [];
    const { view, downloads } = await setup(
      [shortLink({ tags: ["rov"] })],
      {
        visits: async (params) => {
          asked.push(params);
          return {
            from: "2026-07-03",
            to: "2026-09-30",
            rows: [{ slug: "register", title: "ลงทะเบียน", day: "2026-09-30", qr: 4, link: 1 }],
          };
        },
      },
      true,
      ["rov"],
    );
    fireEvent.click(
      within(await view.findByRole("group", { name: "กรองตามแท็ก" })).getByRole("button", {
        name: "rov",
      }),
    );
    await exportMenu(view, /ยอดเข้าชมรายวัน/);
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(asked).toEqual([{ days: 90, mine: false, tag: "rov" }]);
    expect(downloads[0]?.name).toBe("it3k-links-rov-visits-2026-07-03-2026-09-30.csv");
    expect(await text(defined(downloads[0]).blob)).toContain("2026-09-30,register,ลงทะเบียน,4,1");
  });
});
