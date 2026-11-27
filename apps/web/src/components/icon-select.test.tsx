import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { choose, defined } from "@/test/query";

import { IconSelect, type IconSelectItem, groupItems, matchesQuery } from "./icon-select";

afterEach(cleanup);

const DIVISIONS: IconSelectItem<string>[] = [
  { value: null, label: "ทุกประเภท" },
  ...["ชาย", "หญิง", "ผสม"].map((name, i) => ({
    value: `fb-${i}`,
    label: name,
    group: "ฟุตบอล",
    groupIcon: <span data-testid="fb-mark" aria-hidden />,
    triggerLabel: `ฟุตบอล · ${name}`,
  })),
  ...["ชายเดี่ยว", "หญิงเดี่ยว", "ชายคู่", "หญิงคู่", "คู่ผสม"].map((name, i) => ({
    value: `bd-${i}`,
    label: name,
    group: "แบดมินตัน",
    triggerLabel: `แบดมินตัน · ${name}`,
  })),
];

function Harness({ items }: { items: IconSelectItem<string>[] }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <>
      <IconSelect label="ประเภท" items={items} value={value} onChange={setValue} />
      <output>{value ?? "none"}</output>
    </>
  );
}

describe("groupItems", () => {
  test("keeps unheaded items first and groups in the order they appear", () => {
    expect(groupItems(DIVISIONS).map((group) => [group.value, group.items.length])).toEqual([
      ["", 1],
      ["ฟุตบอล", 3],
      ["แบดมินตัน", 5],
    ]);
  });
});

describe("matchesQuery", () => {
  test("matches a group's name as well as the label", () => {
    const men = defined(DIVISIONS[1], "the first football division");
    expect(matchesQuery(men, "ฟุตบอล")).toBe(true);
    expect(matchesQuery(men, "ชาย")).toBe(true);
    expect(matchesQuery(men, "แบด")).toBe(false);
    expect(matchesQuery(men, "  ")).toBe(true);
  });
});

describe("IconSelect", () => {
  test("a short list has no search box but still shows group headings", async () => {
    render(<Harness items={DIVISIONS.slice(0, 4)} />);
    fireEvent.click(screen.getByRole("combobox", { name: "ประเภท" }));
    await screen.findByRole("option", { name: "หญิง" });
    expect(screen.queryByRole("combobox", { name: "ค้นหาประเภท" })).toBeNull();
    expect(screen.getByText("ฟุตบอล")).toBeTruthy();
  });

  test("a long list is searched, by group name too, and shows the trigger label once picked", async () => {
    render(<Harness items={DIVISIONS} />);
    const trigger = screen.getByRole("combobox", { name: "ประเภท" });
    fireEvent.click(trigger);
    const search = await screen.findByRole("combobox", { name: "ค้นหาประเภท" });
    fireEvent.change(search, { target: { value: "แบดมินตัน" } });
    expect(screen.queryByRole("option", { name: "ผสม" })).toBeNull();
    expect(screen.getByRole("option", { name: "คู่ผสม" })).toBeTruthy();

    // The popup is still open from the search, so pick straight from it.
    const option = screen.getByRole("option", { name: "ชายคู่" });
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.click(option);
    expect(screen.getByRole("status").textContent).toBe("bd-2");
    expect(trigger.textContent).toContain("แบดมินตัน · ชายคู่");

    // The shared helper opens it again from closed.
    await choose(trigger, "หญิง");
    expect(screen.getByRole("status").textContent).toBe("fb-1");
  });

  test("typing what nothing matches says so", async () => {
    render(<Harness items={DIVISIONS} />);
    fireEvent.click(screen.getByRole("combobox", { name: "ประเภท" }));
    const search = await screen.findByRole("combobox", { name: "ค้นหาประเภท" });
    fireEvent.change(search, { target: { value: "ฟันดาบ" } });
    expect(await screen.findByText("ไม่พบตัวเลือก")).toBeTruthy();
  });
});
