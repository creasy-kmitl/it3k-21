import { describe, expect, test } from "bun:test";
import {
  sampleContext,
  sampleCustom,
  sampleInvitation,
  sampleProfileSubmitted,
  sampleSportApproved,
  sampleSportRegistered,
  sampleSportRejected,
  sampleTicketClaimed,
} from "./fixtures";
import { formatEventTime } from "./format";
import { renderEmail } from "./render";
import {
  hasContent,
  imageSources,
  publicFileId,
  richTextDocSchema,
  type RichTextDoc,
} from "./rich-text";

const FILE_ID = "0b6d3a9e-2f4c-4e7a-9a51-3d2c1b0a9f8e";
const ownImage = `${sampleContext.apiOrigin}/api/files/public/${FILE_ID}`;

describe("renderEmail", () => {
  test("profile summary lists what the person entered", async () => {
    const out = await renderEmail(sampleProfileSubmitted, sampleContext);
    expect(out.subject).toBe("ได้รับข้อมูลลงทะเบียนของคุณแล้ว · IT3Kings");
    expect(out.html).toContain("สถาบันเทคโนโลยีพระจอมเกล้าเจ้าคุณทหารลาดกระบัง");
    expect(out.html).toContain("0812345678");
    expect(out.html).toContain(`${sampleContext.webOrigin}/me`);
    expect(out.text).toContain("หอบหืด");
  });

  test("sport registration shows the division and the pending status", async () => {
    const out = await renderEmail(sampleSportRegistered, sampleContext);
    expect(out.subject).toContain("ฟุตบอล");
    expect(out.html).toContain("รอตรวจสอบ");
    expect(out.html).toContain("หมายเลขเสื้อ");
    expect(out.html).not.toContain("ชื่อในเกม");
  });

  test("review result names the outcome and the reviewer's note", async () => {
    const approved = await renderEmail(sampleSportApproved, sampleContext);
    expect(approved.subject).toContain("ได้รับการอนุมัติแล้ว");
    const rejected = await renderEmail(sampleSportRejected, sampleContext);
    expect(rejected.subject).toContain("ไม่ผ่านการอนุมัติ");
    expect(rejected.html).toContain("รหัสนักศึกษาไม่ตรงกับบัตร");
  });

  test("ticket links to the ticket page in Bangkok time", async () => {
    const out = await renderEmail(sampleTicketClaimed, sampleContext);
    expect(out.html).toContain(`${sampleContext.webOrigin}/tickets/opening-ceremony`);
    expect(out.text).toContain("17:00–19:30 น.");
  });

  test("invitation names the role, department and the address to sign in with", async () => {
    const out = await renderEmail(sampleInvitation, sampleContext);
    expect(out.subject).toBe("คุณได้รับคำเชิญเข้าใช้งาน · IT3Kings");
    expect(out.html).toContain(`${sampleContext.webOrigin}/login`);
    expect(out.html).toContain("Tech/Live");
    expect(out.html).toContain("สมชาย ใจดี");
    expect(out.html).toContain("วิทยาเขตกรุงเทพฯ");
    expect(out.text).toContain("friend@gmail.com");
    expect(out.text).toContain("2 ธันวาคม 2569");
  });

  test("custom email keeps the staff subject and renders the document", async () => {
    const out = await renderEmail(sampleCustom, sampleContext);
    expect(out.subject).toBe(sampleCustom.subject);
    expect(out.html).toContain("<strong>นัดซ้อมพิธีเปิด</strong>");
    expect(out.html).toContain("<ul");
    expect(out.text).toContain("ชุดกีฬาของสถาบัน");
  });

  test("text from people is escaped, never markup", async () => {
    const out = await renderEmail(
      {
        ...sampleSportRejected,
        registration: { ...sampleSportRejected.registration, note: "<script>alert(1)</script>" },
      },
      sampleContext,
    );
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
  });

  test("images from other hosts are dropped at render time", async () => {
    const doc: RichTextDoc = {
      type: "doc",
      content: [
        { type: "image", attrs: { src: "https://tracker.example/pixel.gif" } },
        { type: "image", attrs: { src: ownImage, alt: "โปสเตอร์" } },
      ],
    };
    const out = await renderEmail({ ...sampleCustom, content: doc }, sampleContext);
    expect(out.html).not.toContain("tracker.example");
    expect(out.html).toContain(ownImage);
  });
});

describe("richTextDocSchema", () => {
  const paragraph = (text: string, marks?: unknown[]) => ({
    type: "paragraph",
    content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
  });

  test("accepts what the editor produces and strips unknown attributes", () => {
    const parsed = richTextDocSchema.parse({
      type: "doc",
      content: [
        { ...paragraph("hi"), attrs: { textAlign: null } },
        { type: "image", attrs: { src: ownImage, alt: null, title: null, width: null } },
      ],
    });
    expect(parsed.content[1]).toEqual({ type: "image", attrs: { src: ownImage, alt: null } });
  });

  test("refuses script links, unknown nodes and deep nesting", () => {
    const bad = [
      {
        type: "doc",
        content: [paragraph("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }])],
      },
      { type: "doc", content: [{ type: "codeBlock", content: [] }] },
      { type: "doc", content: [{ type: "image", attrs: { src: "data:image/png;base64,AAAA" } }] },
      { type: "doc", content: [] },
    ];
    for (const doc of bad) expect(richTextDocSchema.safeParse(doc).success).toBe(false);

    let nested: unknown = paragraph("deep");
    for (let i = 0; i < 20; i++) nested = { type: "blockquote", content: [nested] };
    expect(richTextDocSchema.safeParse({ type: "doc", content: [nested] }).success).toBe(false);
  });

  test("finds images anywhere and tells empty documents apart", () => {
    const doc = richTextDocSchema.parse({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "image", attrs: { src: ownImage } }] }],
        },
      ],
    });
    expect(imageSources(doc)).toEqual([ownImage]);
    expect(hasContent(doc)).toBe(true);
    expect(
      hasContent(richTextDocSchema.parse({ type: "doc", content: [{ type: "paragraph" }] })),
    ).toBe(false);
  });

  test("publicFileId only accepts this API's public file URLs", () => {
    expect(publicFileId(ownImage, sampleContext.apiOrigin)).toBe(FILE_ID);
    expect(
      publicFileId(`https://evil.example/api/files/public/${FILE_ID}`, sampleContext.apiOrigin),
    ).toBeNull();
    expect(publicFileId(`${ownImage}/../x`, sampleContext.apiOrigin)).toBeNull();
  });
});

describe("formatEventTime", () => {
  test("names the end date when a range crosses midnight in Bangkok", () => {
    const start = Date.UTC(2026, 11, 5, 15, 0); // 22:00 Bangkok
    const end = Date.UTC(2026, 11, 5, 18, 0); // 01:00 next day
    expect(formatEventTime(start, end)).toContain("ถึง");
    expect(formatEventTime(start, null)).toEndWith("22:00 น.");
  });
});
