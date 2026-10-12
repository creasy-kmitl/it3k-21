// Tests for @it3k/ui's ColorPicker. They live here because the UI package has
// no test setup of its own; the web app's jsdom preload covers it.
import { afterEach, describe, expect, test } from "bun:test";
import { ColorPicker, hexToHsv, hsvToHex } from "@it3k/ui/components/color-picker";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

afterEach(cleanup);

function Harness({
  initial = "#c10007",
  onChange,
}: {
  initial?: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="c">สีจุด</label>
      <ColorPicker
        id="c"
        label="สีจุด"
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        swatches={[{ value: "#1e3a8a", label: "น้ำเงินเข้ม" }]}
      />
    </>
  );
}

const input = () => screen.getByLabelText("สีจุด") as HTMLInputElement;

describe("hex ↔ hsv", () => {
  test("round-trips every channel extreme and a few brand colours", () => {
    for (const hex of [
      "#000000",
      "#ffffff",
      "#ff0000",
      "#00ff00",
      "#0000ff",
      "#c10007",
      "#1a1a1a",
      "#7f3fbf",
    ]) {
      const hsv = hexToHsv(hex);
      expect(hsv).not.toBeNull();
      expect(hsvToHex(hsv ?? { h: 0, s: 0, v: 0 })).toBe(hex);
    }
  });

  test("rejects anything but #rrggbb", () => {
    for (const bad of ["red", "#fff", "#12345g", ""]) expect(hexToHsv(bad)).toBeNull();
  });
});

describe("ColorPicker", () => {
  test("passes on only complete colours", () => {
    const changes: string[] = [];
    render(<Harness onChange={(next) => changes.push(next)} />);
    fireEvent.change(input(), { target: { value: "#00" } });
    expect(input().getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input(), { target: { value: "#00AA11" } });
    expect(changes).toEqual(["#00aa11"]);
    expect(input().getAttribute("aria-invalid")).toBe("false");
  });

  test("a half-typed colour goes back on blur", () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: "#12" } });
    fireEvent.blur(input());
    expect(input().value).toBe("#c10007");
  });

  test("the swatch opens a picker whose presets set the colour", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "เลือกสีจุด" }));
    const swatch = await screen.findByRole("button", { name: "น้ำเงินเข้ม" });
    expect(swatch.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(swatch);
    expect(input().value).toBe("#1e3a8a");
    expect(swatch.getAttribute("aria-pressed")).toBe("true");
  });

  test("the shade square moves with the arrow keys", async () => {
    const changes: string[] = [];
    render(<Harness initial="#808080" onChange={(next) => changes.push(next)} />);
    fireEvent.click(screen.getByRole("button", { name: "เลือกสีจุด" }));
    const area = await screen.findByRole("slider", { name: "ความสดและความสว่างของสีจุด" });
    fireEvent.keyDown(area, { key: "ArrowUp", shiftKey: true });
    // Grey (128/255) brightened by 10% of full scale is 154: still grey, no hue appears.
    expect(changes).toEqual(["#9a9a9a"]);
    fireEvent.keyDown(area, { key: "Tab" });
    expect(changes).toHaveLength(1);
  });
});
