import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import { fakeApis, fakeUsersApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import UserMenu, { type UserMenuClient } from "./user-menu";

afterEach(cleanup);

function client(role: string): UserMenuClient {
  return {
    useSession: () => ({
      isPending: false,
      data: { user: { name: "Somchai", email: "somchai@kmitl.ac.th", image: null, role } },
    }),
    signOut: (async () => ({ data: { success: true }, error: null })) as never,
  };
}

async function openMenu(role: string, viewedRole?: string) {
  const users = fakeUsersApi({
    me: async () =>
      ({
        id: "u-1",
        role: "staff",
        department: { id: "d-1", name: "Tech/Live", icon: "tv", color: "blue" },
        seatRole: "head",
        canManageUsers: false,
        canManageDepartments: false,
        institution: null,
        sportAccess: { permissions: [] },
        canSendEmail: false,
        canManageBotTokens: false,
        viewingAs: false,
      }) as never,
  });
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await renderAtRoot(() => (
    <QueryClientProvider client={query}>
      <ApiProvider value={fakeApis({ users })}>
        <UserMenu client={client(role)} role={viewedRole} />
      </ApiProvider>
    </QueryClientProvider>
  ));
  fireEvent.click(await view.findByRole("button", { name: /Somchai/ }));
  await screen.findByRole("menuitem", { name: "ออกจากระบบ" });
  return view;
}

const item = (name: string) => screen.queryByRole("menuitem", { name });

describe("UserMenu", () => {
  test("a participant gets their profile and tickets, nothing else", async () => {
    await openMenu("participant");
    expect(item("โปรไฟล์ของฉัน")).toBeTruthy();
    expect(item("ตั๋วของฉัน")?.getAttribute("href")).toBe("/me/tickets");
    expect(item("ระบบนักกีฬา")).toBeNull();
    expect(item("ระบบทีมงาน")).toBeNull();
    expect(screen.getAllByText("ผู้เข้าร่วม").length).toBeGreaterThan(0);
  });

  test("an athlete also gets the athlete system", async () => {
    await openMenu("athlete");
    expect(item("ระบบนักกีฬา")?.getAttribute("href")).toBe("/sports");
    expect(item("ระบบทีมงาน")).toBeNull();
  });

  test("a member gets the staff system and their seat", async () => {
    await openMenu("staff");
    expect(item("ระบบทีมงาน")?.getAttribute("href")).toBe("/staff/dashboard");
    expect(await screen.findByText("หัวหน้าฝ่าย Tech/Live")).toBeTruthy();
  });

  test("follows the role the page runs as, not the session's", async () => {
    await openMenu("admin", "athlete");
    expect(item("ระบบนักกีฬา")).toBeTruthy();
    expect(item("ระบบทีมงาน")).toBeNull();
  });
});
