import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import { ApiError } from "@/lib/leadership";
import { renderAtRoot } from "@/test/router";

import RouteError from "./route-error";

afterEach(cleanup);

function renderError(error: unknown, reset = () => {}) {
  return renderAtRoot(() => <RouteError error={error as Error} reset={reset} info={undefined} />);
}

describe("RouteError", () => {
  test("a failed fetch reads as a dictionary entry with Thai copy, not the browser's text", async () => {
    const view = await renderError(new TypeError("Failed to fetch"));
    expect(await view.findByRole("heading", { name: "ขาดการติดต่อ" })).toBeTruthy();
    expect(view.getByText("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้")).toBeTruthy();
    // The raw text only appears inside the folded technical details.
    expect(view.container.querySelector("details")?.textContent).toContain("Failed to fetch");
    expect(view.getByRole("link", { name: "กลับหน้าแรก" })).toBeTruthy();
  });

  test("retry resets the error and reloads the route", async () => {
    const reset = mock(() => {});
    const view = await renderError(new ApiError(500, "Internal error"), reset);
    expect(await view.findByRole("heading", { name: "5·0·0" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "ลองอีกครั้ง" }));
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
  });

  test("a stale tab offers a reload", async () => {
    const view = await renderError(new TypeError("Importing a module script failed."));
    expect(await view.findByRole("heading", { name: "อัปเดต" })).toBeTruthy();
    expect(view.getByRole("button", { name: "โหลดหน้าใหม่" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "ลองอีกครั้ง" })).toBeNull();
  });

  test("forbidden shows 403 with no retry", async () => {
    const view = await renderError(new ApiError(403, "Forbidden"));
    expect(await view.findByRole("heading", { name: "4·0·3" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "ลองอีกครั้ง" })).toBeNull();
  });
});
