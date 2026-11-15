import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import { renderWithQuery } from "@/test/query";
import { type ViewAsApi, resetViewAs } from "@/lib/view-as";

import { type BannerSessionClient, ViewModeBanner } from "./view-mode-banner";

afterEach(() => {
  cleanup();
  resetViewAs();
});

type Session = NonNullable<ReturnType<BannerSessionClient["useSession"]>["data"]>;

function client(session: Session | null, stops: string[] = []): BannerSessionClient {
  return {
    useSession: () => ({ data: session }),
    admin: {
      stopImpersonating: async () => {
        stops.push("stop");
        return { error: null };
      },
    },
  };
}

function api(overrides: Partial<ViewAsApi> = {}): ViewAsApi {
  return {
    get: async () => ({ active: false }),
    start: () => Promise.reject(new Error("Unexpected start")),
    stop: async () => ({ active: false }),
    ...overrides,
  };
}

const admin = (impersonatedBy: string | null = null, createdAt = new Date()): Session => ({
  user: {
    name: impersonatedBy ? "Target Person" : "Admin",
    role: impersonatedBy ? "staff" : "admin",
  },
  session: { impersonatedBy, createdAt },
});

describe("ViewModeBanner", () => {
  test("shows nothing for an admin acting as themselves", async () => {
    let asked = 0;
    const view = renderWithQuery(
      <ViewModeBanner
        client={client(admin())}
        api={api({
          get: async () => {
            asked++;
            return { active: false };
          },
        })}
      />,
    );
    await waitFor(() => expect(asked).toBe(1));
    expect(view.queryByRole("status")).toBeNull();
  });

  test("never asks about a view for anyone but an admin", async () => {
    const view = renderWithQuery(
      <ViewModeBanner
        client={client({
          user: { name: "Staff", role: "staff" },
          session: { createdAt: new Date() },
        })}
        api={api({ get: () => Promise.reject(new Error("Unexpected get")) })}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(view.queryByRole("status")).toBeNull();
  });

  test("describes an active view and ends it", async () => {
    const went: string[] = [];
    let stopped = false;
    const view = renderWithQuery(
      <ViewModeBanner
        client={client(admin())}
        navigate={(path) => went.push(path)}
        api={api({
          get: async () => ({
            active: true,
            kind: "head",
            department: { id: "d-tech", name: "Tech/Live", icon: "monitor-play", color: "indigo" },
            institution: "kmitl",
          }),
          stop: async () => {
            stopped = true;
            return { active: false };
          },
        })}
      />,
    );
    expect(await view.findByText("หัวหน้าฝ่าย · Tech/Live · สจล.")).toBeTruthy();
    expect(view.getByRole("status").textContent).toContain("ดูอย่างเดียว");
    fireEvent.click(view.getByRole("button", { name: "ออกจากโหมดจำลอง" }));
    await waitFor(() => expect(went).toEqual(["/staff/dashboard"]));
    expect(stopped).toBe(true);
  });

  test("names the impersonated account and returns to the admin's own", async () => {
    const stops: string[] = [];
    const went: string[] = [];
    const view = renderWithQuery(
      <ViewModeBanner
        client={client(admin("admin-1"), stops)}
        navigate={(path) => went.push(path)}
        api={api({ get: () => Promise.reject(new Error("Unexpected get")) })}
      />,
    );
    const banner = await view.findByRole("status");
    expect(banner.textContent).toContain("Target Person");
    expect(banner.textContent).toContain("บันทึกว่าคุณเป็นผู้ทำ");
    fireEvent.click(view.getByRole("button", { name: "กลับสู่บัญชีของฉัน" }));
    await waitFor(() => expect(went).toEqual(["/staff/users"]));
    expect(stops).toEqual(["stop"]);
  });

  test("says when the hour of impersonation is over, still offering the way back", async () => {
    const view = renderWithQuery(
      <ViewModeBanner
        client={client(admin("admin-1", new Date(Date.now() - 61 * 60 * 1000)))}
        api={api()}
      />,
    );
    expect((await view.findByRole("status")).textContent).toContain("หมดเวลาสวมบัญชี");
    expect(view.getByRole("button", { name: "กลับสู่บัญชีของฉัน" })).toBeTruthy();
  });
});
