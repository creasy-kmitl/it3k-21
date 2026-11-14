import { describe, expect, test } from "bun:test";

import { createScanGate, nextCamera } from "./kiosk";

describe("createScanGate", () => {
  test("lets a code through once, then holds the same code back for the cooldown", () => {
    let now = 0;
    const gate = createScanGate(5000, () => now);
    expect(gate(" u-1 ")).toBe("u-1");
    now = 1000;
    expect(gate("u-1")).toBeNull();
    expect(gate("u-2")).toBe("u-2");
    now = 2000;
    // u-2 was the last code, so u-1 passes again.
    expect(gate("u-1")).toBe("u-1");
    now = 7001;
    expect(gate("u-1")).toBe("u-1");
    expect(gate("   ")).toBeNull();
  });
});

describe("nextCamera", () => {
  const cameras = [{ deviceId: "front" }, { deviceId: "back" }, { deviceId: "wide" }];
  test("moves to the next camera and wraps around", () => {
    expect(nextCamera(cameras, "front")).toBe("back");
    expect(nextCamera(cameras, "wide")).toBe("front");
    expect(nextCamera(cameras, null)).toBe("front");
    expect(nextCamera([], "front")).toBeNull();
  });
});
