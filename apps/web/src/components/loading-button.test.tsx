import { afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { Save } from "lucide-react";

import { LoadingButton } from "./loading-button";

afterEach(cleanup);

test("an idle button shows its icon and can be clicked", () => {
  const view = render(
    <LoadingButton loading={false} icon={Save}>
      บันทึก
    </LoadingButton>,
  );
  const button = view.getByRole("button", { name: "บันทึก" });
  expect(button.hasAttribute("disabled")).toBe(false);
  expect(button.getAttribute("aria-busy")).toBeNull();
  expect(button.querySelector("svg.lucide-save")).toBeTruthy();
  expect(button.querySelector("[data-slot=spinner]")).toBeNull();
});

test("a loading button is disabled, busy, and spins in place of its icon", () => {
  const view = render(
    <LoadingButton loading icon={Save}>
      บันทึก
    </LoadingButton>,
  );
  // The spinner is hidden from assistive tech, so the name stays the label.
  const button = view.getByRole("button", { name: "บันทึก" });
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.querySelector("svg.lucide-save")).toBeNull();
  const spinner = button.querySelector("[data-slot=spinner]");
  expect(spinner?.getAttribute("data-icon")).toBe("inline-start");
  expect(spinner?.getAttribute("aria-hidden")).toBe("true");
});

test("an icon-only button keeps its label and swaps the icon for the spinner", () => {
  const view = render(<LoadingButton loading icon={Save} aria-label="บันทึก Somchai" />);
  const button = view.getByRole("button", { name: "บันทึก Somchai" });
  const spinner = button.querySelector("[data-slot=spinner]");
  expect(spinner).toBeTruthy();
  expect(spinner?.hasAttribute("data-icon")).toBe(false);
});

test("disabled still applies while idle", () => {
  const view = render(
    <LoadingButton loading={false} disabled>
      สมัคร
    </LoadingButton>,
  );
  const button = view.getByRole("button", { name: "สมัคร" });
  expect(button.hasAttribute("disabled")).toBe(true);
  expect(button.getAttribute("aria-busy")).toBeNull();
});
