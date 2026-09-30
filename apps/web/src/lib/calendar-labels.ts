import type {
  CalendarChangeAction,
  CalendarStatus,
  CalendarVisibility,
} from "@it3k/db/calendar-rules";

import { formatBangkok } from "./bangkok-time";

export const STATUS_LABELS: Record<CalendarStatus, string> = {
  draft: "ร่าง",
  confirmed: "ยืนยันแล้ว",
  cancelled: "ยกเลิก",
};

export const VISIBILITY_LABELS: Record<CalendarVisibility, string> = {
  internal: "ภายในทีม",
  public: "สาธารณะ",
};

/**
 * Change-log actions. Keyed by string, not the current enum: the log keeps
 * actions the calendar no longer has, which fall back to their key.
 */
export const ACTION_LABELS: Record<CalendarChangeAction, string> & Record<string, string> = {
  create: "สร้างรายการ",
  update: "แก้ไข",
  reschedule: "เลื่อนเวลา",
  status: "เปลี่ยนสถานะ",
  cancel: "ยกเลิก",
  publish: "เปลี่ยนการเผยแพร่",
  delete: "ลบรายการ",
};

/** Change-log field names. Unknown fields fall back to their key. */
export const FIELD_LABELS: Record<string, string> = {
  title: "ชื่อรายการ",
  departmentId: "แผนก",
  status: "สถานะ",
  startAt: "เริ่ม",
  endAt: "สิ้นสุด",
  ownerId: "ผู้รับผิดชอบ",
  venue: "สถานที่",
  notes: "โน้ตภายใน",
  visibility: "การเผยแพร่",
  approvedAt: "อนุมัติเผยแพร่",
  approvedById: "ผู้อนุมัติ",
};

type NoticeLike = { kind: string; itemTitle: string; data: Record<string, unknown> };

const when = (value: unknown) =>
  typeof value === "number" ? formatBangkok(value, "dateTime") : null;

/** A notification in one Thai sentence. */
export function describeNotification(notice: NoticeLike): string {
  const { data, itemTitle: title } = notice;
  const reason = typeof data.reason === "string" && data.reason ? ` (เหตุผล: ${data.reason})` : "";
  switch (notice.kind) {
    case "assignment":
      return `คุณเป็นผู้รับผิดชอบ "${title}"${when(data.startAt) ? ` เริ่ม ${when(data.startAt)}` : ""}`;
    case "reschedule":
      return `"${title}" ถูกเลื่อนเป็น ${when(data.startAt) ?? "เวลาใหม่"}${reason}`;
    case "cancel":
      return `"${title}" ถูกยกเลิก${reason}`;
    default:
      return title;
  }
}
