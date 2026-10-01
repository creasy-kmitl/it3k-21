import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { defined } from "@/test/query";

import { Route } from "./$slug";

afterEach(cleanup);

/** The page for one reason; the worker supplies it on the server, the test here. */
async function open(reason: string, unlock: string | null = null) {
  const root = createRootRoute({ component: Outlet });
  const page = createRoute({
    getParentRoute: () => root,
    path: "/l/$slug",
    loader: () => ({ reason, unlock }),
    component: defined(Route.options.component, "page"),
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ["/l/register"] }),
  });
  await act(() => router.load());
  render(<RouterProvider router={router} />);
}

describe("/l/$slug", () => {
  test.each([
    ["missing", "4·0·4", "ไม่มีอยู่จริง"],
    ["disabled", "ปิด·แล้ว", "ปิดลิงก์นี้ไว้"],
    ["expired", "หมด·อายุ", "ใช้ได้ถึงวันที่"],
    ["error", "ขัด·ข้อง", "ขัดข้องชั่วคราว"],
  ])("%s", async (reason, word, meaning) => {
    await open(reason);
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe(word);
    expect(screen.getByText(new RegExp(meaning))).toBeTruthy();
    expect(screen.getByRole("link", { name: "กลับหน้าแรก" }).getAttribute("href")).toBe("/");
  });

  test("a locked link asks for its password with a plain form posting back here", async () => {
    await open("locked");
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("ล็อก·ไว้");
    const field = screen.getByLabelText("รหัสผ่าน") as HTMLInputElement;
    expect(field.name).toBe("password");
    expect(field.type).toBe("password");
    const form = field.closest("form");
    expect(form?.getAttribute("method")).toBe("post");
    // No action: it posts to the scanned address, query and all.
    expect(form?.hasAttribute("action")).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test.each([
    ["wrong", "รหัสผ่านไม่ถูกต้อง"],
    ["limited", "รอประมาณหนึ่งนาที"],
  ])("says why the last password failed: %s", async (unlock, message) => {
    await open("locked", unlock);
    expect((await screen.findByRole("alert")).textContent).toContain(message);
  });
});
