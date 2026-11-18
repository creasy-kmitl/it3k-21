import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { ComposeEmail, EmailAudiences, EmailsApi } from "@/lib/emails";
import type { Me } from "@/lib/users";
import { choose, fakeEmailsApi, fakeUsersApi, renderRoute } from "@/test/query";

import { Route, parseEmails, toAudience } from "./email";

afterEach(cleanup);

function me(emailAccess: Me["emailAccess"]): Me {
  return {
    id: "me",
    role: "staff",
    department: null,
    seatRole: null,
    canManageUsers: false,
    canManageDepartments: false,
    assignableKinds: [],
    institution: null,
    sportAccess: { permissions: [], scope: { kind: "none" } },
    emailAccess,
    viewingAs: false,
  };
}

function audiences(scope: EmailAudiences["scope"] = { kind: "all" }): EmailAudiences {
  return {
    scope,
    institutions: ["kmitl", "kmutt", "kmutnb-bangkok", "kmutnb-prachinburi"],
    sports: [
      {
        id: "s-football",
        name: "ฟุตบอล",
        divisions: [{ id: "d-football-male", name: "ฟุตบอลชาย" }],
      },
    ],
    events: [{ id: "e-open", name: "พิธีเปิด", startAt: "2026-12-01T10:00:00.000Z" }],
  };
}

function setup(access: Me["emailAccess"], overrides: Partial<EmailsApi> = {}) {
  return renderRoute(Route, {
    users: fakeUsersApi({ me: async () => me(access) }),
    emails: fakeEmailsApi({
      audiences: async () => audiences(access ?? undefined),
      history: async () => ({ items: [] }),
      ...overrides,
    }),
  });
}

/** Types into the editor the way a browser would: ProseMirror reads the DOM change back. */
async function typeBody(text: string) {
  const editor = await screen.findByRole("textbox", { name: "เนื้อหาอีเมล" });
  const paragraph = editor.querySelector("p");
  if (!paragraph) throw new Error("no paragraph");
  paragraph.textContent = text;
  await waitFor(() => expect(editor.textContent).toContain(text));
}

describe("toAudience", () => {
  test("athletes need at least one status and drop divisions without a sport", () => {
    const base = {
      kind: "athletes" as const,
      institutions: [],
      sportId: null,
      divisionIds: ["d-x"],
      statuses: [],
      eventId: null,
      people: [],
      emails: "",
    };
    expect(toAudience(base)).toEqual({ error: "เลือกสถานะการสมัครอย่างน้อยหนึ่งแบบ" });
    expect(toAudience({ ...base, statuses: ["approved"] })).toEqual({
      kind: "athletes",
      sportId: null,
      divisionIds: [],
      statuses: ["approved"],
      institutions: [],
    });
  });

  test("manual refuses bad addresses and an empty list", () => {
    const base = {
      kind: "manual" as const,
      institutions: [],
      sportId: null,
      divisionIds: [],
      statuses: [],
      eventId: null,
      people: [],
      emails: "",
    };
    expect(toAudience(base)).toEqual({ error: "เพิ่มผู้รับอย่างน้อยหนึ่งคน" });
    expect(toAudience({ ...base, emails: "a@b.co, nope" })).toEqual({ error: "อีเมลไม่ถูกต้อง: nope" });
    expect(toAudience({ ...base, emails: "a@b.co\na@b.co; c@d.co" })).toEqual({
      kind: "manual",
      userIds: [],
      emails: ["a@b.co", "c@d.co"],
    });
  });

  test("parseEmails splits on commas, semicolons and lines", () => {
    expect(parseEmails(" x@y.co,\n\nz@y.co ; bad ")).toEqual({
      valid: ["x@y.co", "z@y.co"],
      invalid: ["bad"],
    });
  });
});

describe("EmailPage", () => {
  test("refuses accounts without the right to send", async () => {
    setup(null);
    expect(await screen.findByText("คุณไม่มีสิทธิ์ส่งอีเมล")).toBeTruthy();
    expect(screen.queryByLabelText("หัวเรื่อง")).toBeNull();
  });

  test("asks for a subject and a body before previewing", async () => {
    setup({ kind: "all" });
    const button = await screen.findByRole("button", { name: "ดูตัวอย่างและส่ง" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toBe("กรอกหัวเรื่อง");
    fireEvent.change(screen.getByLabelText("หัวเรื่อง"), { target: { value: "แจ้งข่าว" } });
    fireEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toBe("เขียนเนื้อหาอีเมล");
  });

  test("previews, confirms with the count, then sends what was written", async () => {
    const previewed: ComposeEmail[] = [];
    const sent: ComposeEmail[] = [];
    setup(
      { kind: "all" },
      {
        preview: async (json) => {
          previewed.push(json);
          return { recipientCount: 12, tooMany: false, html: "<p>ตัวอย่าง</p>" };
        },
        send: async (json) => {
          sent.push(json);
          return { id: "00000000-0000-4000-8000-000000000001", recipientCount: 12 };
        },
      },
    );
    fireEvent.change(await screen.findByLabelText("หัวเรื่อง"), { target: { value: "  แจ้งข่าว  " } });
    fireEvent.click(await screen.findByRole("button", { name: "นักกีฬา" }));
    await choose(screen.getByRole("combobox", { name: "กีฬา" }), "ฟุตบอล");
    fireEvent.click(await screen.findByRole("button", { name: "ฟุตบอลชาย" }));
    fireEvent.click(screen.getByRole("button", { name: "รอตรวจสอบ" }));
    fireEvent.click(screen.getByRole("button", { name: "มจธ." }));
    await typeBody("สวัสดีทุกคน");

    fireEvent.click(screen.getByRole("button", { name: "ดูตัวอย่างและส่ง" }));
    expect(await screen.findByText("จะส่งถึง 12 คน")).toBeTruthy();
    expect(previewed[0]?.subject).toBe("แจ้งข่าว");
    expect(previewed[0]?.audience).toEqual({
      kind: "athletes",
      sportId: "s-football",
      divisionIds: ["d-football-male"],
      statuses: ["approved", "review"],
      institutions: ["kmutt"],
    });
    expect(JSON.stringify(previewed[0]?.content)).toContain("สวัสดีทุกคน");

    fireEvent.click(screen.getByRole("button", { name: "ส่งอีเมล" }));
    expect(await screen.findByText("ส่งถึง 12 คน?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ส่งเลย" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent).toEqual(previewed);
    await waitFor(() =>
      expect((screen.getByLabelText("หัวเรื่อง") as HTMLInputElement).value).toBe(""),
    );
  });

  test("cannot send when nobody matches", async () => {
    setup(
      { kind: "all" },
      { preview: async () => ({ recipientCount: 0, tooMany: false, html: "<p></p>" }) },
    );
    fireEvent.change(await screen.findByLabelText("หัวเรื่อง"), { target: { value: "x" } });
    await typeBody("y");
    const button = screen.getByRole("button", { name: "ดูตัวอย่างและส่ง" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    expect(await screen.findByText("ไม่มีผู้รับที่ตรงกับเงื่อนไข")).toBeTruthy();
    expect((screen.getByRole("button", { name: "ส่งอีเมล" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  test("an institution-scoped sender picks only accounts, never typed addresses", async () => {
    setup(
      { kind: "institution", institution: "kmutt" },
      {
        recipients: async (q) => ({
          items: [{ id: "u-1", name: `คน ${q}`, email: "one@example.com", institution: "kmutt" }],
        }),
      },
    );
    fireEvent.click(await screen.findByRole("button", { name: "ผู้เข้าร่วม" }));
    expect(await screen.findByText("ส่งได้เฉพาะคนใน มจธ.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "สถาบัน" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "ระบุเอง" }));
    expect(screen.queryByLabelText("อีเมลอื่น")).toBeNull();
    fireEvent.change(screen.getByLabelText("ค้นหาผู้รับ"), { target: { value: "ก" } });
    fireEvent.click(await screen.findByRole("button", { name: "เพิ่ม" }));
    expect(await screen.findByRole("button", { name: "เพิ่มแล้ว" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "ผู้รับที่เลือก" }).textContent).toContain("คน ก");
  });

  test("lists past emails", async () => {
    setup(
      { kind: "all" },
      {
        history: async () => ({
          items: [
            {
              id: "c-1",
              subject: "ประกาศผล",
              recipientCount: 30,
              sentCount: 28,
              failedCount: 2,
              senderName: "Tech",
              audienceKind: "athletes",
              createdAt: "2026-11-16T03:00:00.000Z",
            },
          ],
        }),
      },
    );
    expect(await screen.findByText("ประกาศผล")).toBeTruthy();
    expect(screen.getByText("(ไม่สำเร็จ 2)")).toBeTruthy();
  });
});
