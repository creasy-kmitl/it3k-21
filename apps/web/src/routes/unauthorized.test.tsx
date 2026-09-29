import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent } from "@testing-library/react";

import { renderAtRoot } from "@/test/router";

import { Route } from "./unauthorized";

const Unauthorized = Route.options.component!;

afterEach(cleanup);

describe("Unauthorized", () => {
  test("explains that signing in is required", async () => {
    const view = await renderAtRoot(Unauthorized);
    expect(await view.findByRole("heading", { name: "4·0·1" })).toBeTruthy();
    expect(view.getByText(/ต้องเข้าสู่ระบบ/)).toBeTruthy();
  });

  test("links to the login page", async () => {
    const view = await renderAtRoot(Unauthorized);
    fireEvent.click(await view.findByRole("link", { name: /เข้าสู่ระบบ/ }));
    expect(await view.findByText("login page")).toBeTruthy();
    expect(view.router.state.location.pathname).toBe("/login");
  });

  test("shows no contact details", async () => {
    const view = await renderAtRoot(Unauthorized);
    await view.findByRole("heading", { name: "4·0·1" });
    expect(view.container.textContent).not.toMatch(/\d{3}-?\d{3}-?\d{4}/);
  });
});
