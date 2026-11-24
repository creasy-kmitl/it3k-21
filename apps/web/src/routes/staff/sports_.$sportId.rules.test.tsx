import { afterEach, describe, expect, mock, test } from "bun:test";
import { RULES_MAX_LENGTH, type RulesInput } from "@it3k/db/sport-rules";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import { readMarkdownFile } from "@/components/rules-editor";
import { ApiProvider } from "@/lib/api-context";
import type {
  DivisionRulesPage,
  SavedRules,
  SportRulesApi,
  SportRulesPage as SportPage,
} from "@/lib/sport-rules";
import { fakeApis, fakeSportRulesApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { SportRulesPage } from "./sports_.$sportId.rules";

afterEach(cleanup);

const NOW = "2026-11-24T00:00:00.000Z";

function rules(markdown: string, version = 1): SavedRules {
  return { markdown, version, updatedAt: NOW, updatedByName: "Tech" };
}

function sportPage(overrides: Partial<SportPage> = {}): SportPage {
  return {
    sport: { id: "s-badminton", name: "กีฬาแบดมินตัน", code: "badminton" },
    rules: rules("# กีฬาแบดมินตัน\n\n## ข้อ 1. ระเบียบ\n\n- **1.1** ใช้กติกา BWF"),
    divisions: [
      { id: "d-singles", name: "แบดมินตัน เดี่ยวชาย", hasOwnRules: false },
      { id: "d-doubles", name: "แบดมินตัน คู่ชาย", hasOwnRules: true },
    ],
    canEdit: true,
    ...overrides,
  };
}

function divisionPage(overrides: Partial<DivisionRulesPage> = {}): DivisionRulesPage {
  const sport = sportPage();
  return {
    division: { id: "d-singles", name: "แบดมินตัน เดี่ยวชาย", sportId: "s-badminton" },
    rules: null,
    sportRules: sport.rules,
    canEdit: true,
    ...overrides,
  };
}

async function setup(api: SportRulesApi, divisionId?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onSelect = mock((_id: string | undefined) => undefined);
  const view = await renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ sportRules: api })}>
        <SportRulesPage sportId="s-badminton" divisionId={divisionId} onSelect={onSelect} />
      </ApiProvider>
    </QueryClientProvider>
  ));
  return { ...view, onSelect };
}

function markdownFile(text: string, name = "badminton.md") {
  return new File([text], name, { type: "text/markdown" });
}

describe("/staff/sports/$sportId/rules", () => {
  test("shows the sport's rules as Markdown and marks divisions with their own", async () => {
    const view = await setup(
      fakeSportRulesApi({ sport: async () => sportPage({ canEdit: false }) }),
    );
    expect(await view.findByRole("heading", { name: "ข้อ 1. ระเบียบ" })).toBeTruthy();
    expect(view.getByText("1.1").tagName.toLowerCase()).toBe("strong");
    expect(view.getByText(/แก้ไขล่าสุด .* โดย Tech/)).toBeTruthy();
    // Reading only: no edit or upload controls.
    expect(view.queryByRole("button", { name: /แก้ไข/ })).toBeNull();
    expect(view.queryByRole("button", { name: /อัปโหลด/ })).toBeNull();

    const doubles = view.getByRole("button", { name: /แบดมินตัน คู่ชาย/ });
    expect(doubles.querySelector('[aria-label="มีกติกาของตัวเอง"]')).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "แบดมินตัน เดี่ยวชาย" }));
    expect(view.onSelect).toHaveBeenCalledWith("d-singles");
  });

  test("editors change the rules and save them against the version they read", async () => {
    const saved: RulesInput[] = [];
    const view = await setup(
      fakeSportRulesApi({
        sport: async () => sportPage(),
        saveSport: async (_id, input) => {
          saved.push(input);
          return { rules: rules(input.markdown, 2) };
        },
      }),
    );
    fireEvent.click(await view.findByRole("button", { name: "แก้ไข" }));
    const textarea = view.getByLabelText("กติกา (Markdown)") as HTMLTextAreaElement;
    expect(textarea.value).toContain("# กีฬาแบดมินตัน");
    const save = view.getByRole("button", { name: "บันทึก" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: "# ใหม่\n\n15 คะแนน" } });
    expect(view.getByText("ยังไม่ได้บันทึก")).toBeTruthy();
    fireEvent.click(save);
    await waitFor(() => expect(saved).toEqual([{ markdown: "# ใหม่\n\n15 คะแนน", version: 1 }]));
    await waitFor(() => expect(view.queryByLabelText("กติกา (Markdown)")).toBeNull());
  });

  test("an uploaded .md file replaces the draft and shows its preview", async () => {
    const saved: RulesInput[] = [];
    const view = await setup(
      fakeSportRulesApi({
        sport: async () => sportPage(),
        saveSport: async (_id, input) => {
          saved.push(input);
          return { rules: rules(input.markdown, 2) };
        },
      }),
    );
    const input = (await view.findByLabelText("อัปโหลดไฟล์กติกา (.md)")) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [markdownFile("﻿# จากไฟล์\r\n\r\n## ข้อ 2. ใหม่")] } });

    expect(await view.findByRole("heading", { name: "ข้อ 2. ใหม่" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(saved).toEqual([{ markdown: "# จากไฟล์\n\n## ข้อ 2. ใหม่", version: 1 }]),
    );
  });

  test("a division without its own rules shows the sport's and can start from them", async () => {
    const saved: RulesInput[] = [];
    const view = await setup(
      fakeSportRulesApi({
        sport: async () => sportPage(),
        division: async () => divisionPage(),
        saveDivision: async (_id, input) => {
          saved.push(input);
          return { rules: rules(input.markdown) };
        },
      }),
      "d-singles",
    );
    expect(await view.findByText(/ยังไม่มีกติกาของตัวเอง จึงแสดงกติกาของกีฬา/)).toBeTruthy();
    expect(view.getByRole("heading", { name: "ข้อ 1. ระเบียบ" })).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: /เริ่มจากกติกาของกีฬา/ }));
    const textarea = view.getByLabelText("กติกา (Markdown)") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: `${textarea.value}\n\n- มือ 1 และมือ 2` } });
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(saved[0]?.version).toBe(0));
    expect(saved[0]?.markdown).toContain("มือ 1 และมือ 2");
  });

  test("a division's own rules can be removed to fall back to the sport's", async () => {
    const saved: RulesInput[] = [];
    const view = await setup(
      fakeSportRulesApi({
        sport: async () => sportPage(),
        division: async () => divisionPage({ rules: rules("# เฉพาะคู่", 3) }),
        saveDivision: async (_id, input) => {
          saved.push(input);
          return { rules: null };
        },
      }),
      "d-singles",
    );
    fireEvent.click(await view.findByRole("button", { name: /กลับไปใช้กติกาของกีฬา/ }));
    fireEvent.click(await view.findByRole("button", { name: "ลบ" }));
    await waitFor(() => expect(saved).toEqual([{ markdown: "", version: 3 }]));
  });
});

describe("readMarkdownFile", () => {
  test("refuses files that are not Markdown or are too long", async () => {
    await expect(
      readMarkdownFile(new File(["x"], "rules.pdf", { type: "application/pdf" })),
    ).rejects.toThrow("เลือกไฟล์ Markdown (.md)");
    await expect(readMarkdownFile(markdownFile("ก".repeat(RULES_MAX_LENGTH + 1)))).rejects.toThrow(
      "กติกายาวได้ไม่เกิน",
    );
    expect(await readMarkdownFile(markdownFile("a\r\nb"))).toBe("a\nb");
  });
});
