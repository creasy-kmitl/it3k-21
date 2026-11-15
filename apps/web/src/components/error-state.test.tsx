import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { ApiError } from "@/lib/leadership";

import { ErrorState } from "./error-state";

afterEach(cleanup);

describe("ErrorState", () => {
  test("explains a failed fetch in Thai and hides the raw text in the details", () => {
    const view = render(
      <ErrorState
        error={new TypeError("Failed to fetch")}
        onRetry={() => {}}
        title="โหลดรายชื่อไม่สำเร็จ"
      />,
    );
    const alert = view.getByRole("alert");
    expect(alert.getAttribute("data-error-kind")).toBe("network");
    expect(view.getByText("โหลดรายชื่อไม่สำเร็จ")).toBeTruthy();
    expect(view.getByText(/เชื่อมต่อเซิร์ฟเวอร์ไม่ได้/)).toBeTruthy();
    const details = alert.querySelector("details");
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain("Failed to fetch");
  });

  test("retry spins until the refetch settles", async () => {
    let finish = () => {};
    const onRetry = mock(() => new Promise<void>((resolve) => (finish = resolve)));
    const view = render(<ErrorState error={new ApiError(503, "Unavailable")} onRetry={onRetry} />);
    fireEvent.click(view.getByRole("button", { name: "ลองอีกครั้ง" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    const busy = view.getByRole("button", { name: "กำลังลองใหม่…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(busy.querySelector("[data-slot=spinner]")).toBeTruthy();
    await act(async () => finish());
    await waitFor(() => expect(view.getByRole("button", { name: "ลองอีกครั้ง" })).toBeTruthy());
  });

  test("retries by itself when the browser comes back online", () => {
    const onRetry = mock(() => Promise.resolve());
    render(<ErrorState error={new TypeError("Failed to fetch")} onRetry={onRetry} />);
    act(() => {
      window.dispatchEvent(new window.Event("online"));
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("a stale tab offers a reload instead of a retry", () => {
    const view = render(
      <ErrorState
        error={new TypeError("Failed to fetch dynamically imported module")}
        onRetry={() => {}}
      />,
    );
    expect(view.getByRole("button", { name: "โหลดหน้าใหม่" })).toBeTruthy();
    expect(view.queryByRole("button", { name: "ลองอีกครั้ง" })).toBeNull();
  });

  test("a forbidden page offers the way home, not a pointless retry", () => {
    const view = render(<ErrorState error={new ApiError(403, "Forbidden")} onRetry={() => {}} />);
    expect(view.getByText("ไม่มีสิทธิ์เข้าถึง")).toBeTruthy();
    expect(view.queryByRole("button", { name: "ลองอีกครั้ง" })).toBeNull();
    expect(view.getByRole("link", { name: "กลับหน้าแรก" }).getAttribute("href")).toBe("/");
  });

  test("an ended session links to sign in and back", () => {
    window.history.replaceState(null, "", "/staff/users?q=a");
    const view = render(<ErrorState error={new ApiError(401, "Unauthorized")} />);
    expect(view.getByRole("link", { name: "เข้าสู่ระบบอีกครั้ง" }).getAttribute("href")).toBe(
      `/login?to=${encodeURIComponent("/staff/users?q=a")}`,
    );
  });
});
