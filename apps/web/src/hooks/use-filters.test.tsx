import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import { replacesHistory } from "@/lib/list-search";

import { useFilters, useSearchText } from "./use-filters";

afterEach(cleanup);

describe("useFilters", () => {
  test("keeps its own filters when the caller holds none", () => {
    const { result } = renderHook(() => useFilters<{ q?: string; page?: number }>());
    act(() => result.current[1]({ q: "art" }));
    act(() => result.current[1]({ page: 2 }));
    expect(result.current[0]).toEqual({ q: "art", page: 2 });
  });

  test("uses the caller's filters when given", () => {
    const patches: object[] = [];
    const control = { value: { q: "art" }, onChange: (patch: object) => patches.push(patch) };
    const { result } = renderHook(() => useFilters(control));
    expect(result.current[0]).toEqual({ q: "art" });
    act(() => result.current[1]({ q: "tech" }));
    expect(patches).toEqual([{ q: "tech" }]);
  });
});

describe("useSearchText", () => {
  test("starts from the filter and commits typing once it settles", async () => {
    const committed: (string | undefined)[] = [];
    const { result } = renderHook(() => useSearchText("art", (q) => committed.push(q)));
    expect(result.current[0]).toBe("art");
    act(() => result.current[1](" tech "));
    await waitFor(() => expect(committed).toEqual(["tech"]));
  });

  test("commits a cleared box as no filter", async () => {
    const committed: (string | undefined)[] = [];
    const { result } = renderHook(() => useSearchText("art", (q) => committed.push(q)));
    act(() => result.current[1](""));
    await waitFor(() => expect(committed).toEqual([undefined]));
  });

  test("follows the filter when it changes from outside", () => {
    const { result, rerender } = renderHook(({ q }) => useSearchText(q, () => {}), {
      initialProps: { q: "art" },
    });
    rerender({ q: "" });
    expect(result.current[0]).toBe("");
  });
});

describe("replacesHistory", () => {
  test("only a page change adds a history entry", () => {
    expect(replacesHistory({ page: 2 })).toBe(false);
    expect(replacesHistory({ q: "art", page: undefined })).toBe(true);
    expect(replacesHistory({ department: "d-art" })).toBe(true);
  });
});
