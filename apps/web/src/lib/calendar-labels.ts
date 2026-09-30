import type {
  CalendarCategory,
  CalendarChangeAction,
  CalendarMode,
  CalendarStatus,
  CalendarVisibility,
  Game,
  RiskLevel,
} from "@it3k/db/calendar-rules";

import type { CalendarItem } from "./calendar";

export const MODE_LABELS: Record<CalendarMode, string> = {
  operations: "ปฏิบัติการ",
  coordination: "ประสานงาน",
  delivery: "ส่งมอบงาน",
  meetings: "ประชุม",
};

/** Class names per mode. Written out in full so Tailwind can find them. */
export const MODE_STYLES: Record<CalendarMode, { chip: string; dot: string }> = {
  operations: {
    chip: "border-l-rose-500 bg-rose-500/10 text-rose-950 dark:text-rose-100",
    dot: "bg-rose-500",
  },
  coordination: {
    chip: "border-l-amber-500 bg-amber-500/10 text-amber-950 dark:text-amber-100",
    dot: "bg-amber-500",
  },
  delivery: {
    chip: "border-l-sky-500 bg-sky-500/10 text-sky-950 dark:text-sky-100",
    dot: "bg-sky-500",
  },
  meetings: {
    chip: "border-l-violet-500 bg-violet-500/10 text-violet-950 dark:text-violet-100",
    dot: "bg-violet-500",
  },
};

export const CATEGORY_LABELS: Record<CalendarCategory, string> = {
  match: "แข่งขัน",
  broadcast: "ถ่ายทอดสด",
  result_update: "อัปเดตผล",
  technical_check: "ตรวจระบบ",
  rehearsal: "ซ้อม",
  cross_team_meeting: "ประชุมข้ามฝ่าย",
  handoff: "ส่งต่องาน",
  approval: "ขออนุมัติ",
  information_request: "ขอข้อมูล",
  planning: "วางแผน",
  design: "ออกแบบ",
  development: "พัฒนา",
  code_review: "รีวิวโค้ด",
  qa: "QA",
  release: "Release",
  monitoring: "เฝ้าระวัง",
  incident: "Incident",
  post_event_review: "ทบทวนหลังงาน",
};

export const STATUS_LABELS: Record<CalendarStatus, string> = {
  draft: "ร่าง",
  confirmed: "ยืนยันแล้ว",
  ready: "พร้อม",
  live: "Live",
  completed: "เสร็จสิ้น",
  delayed: "ล่าช้า",
  cancelled: "ยกเลิก",
  backlog: "Backlog",
  planned: "วางแผนแล้ว",
  in_progress: "กำลังทำ",
  in_review: "รอรีวิว",
  qa: "กำลัง QA",
  ready_to_release: "พร้อมปล่อย",
  released: "Released",
  rolled_back: "Rolled back",
};

export const GAME_LABELS: Record<Game, string> = {
  tft: "TFT",
  valorant: "VALORANT",
  rov: "RoV",
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  low: "ต่ำ",
  medium: "กลาง",
  high: "สูง",
};

export const VISIBILITY_LABELS: Record<CalendarVisibility, string> = {
  internal: "ภายในทีม",
  public: "สาธารณะ",
};

export const ACTION_LABELS: Record<CalendarChangeAction, string> = {
  create: "สร้างรายการ",
  update: "แก้ไข",
  reschedule: "เลื่อนเวลา",
  status: "เปลี่ยนสถานะ",
  cancel: "ยกเลิก",
  archive: "เก็บถาวร",
  unarchive: "นำกลับมา",
  duplicate: "ทำสำเนา",
  confirm: "ยืนยันข้อมูล",
  publish: "เปลี่ยนการเผยแพร่",
};

/** Change-log field names. Unknown fields fall back to their key. */
export const FIELD_LABELS: Record<string, string> = {
  title: "ชื่อรายการ",
  mode: "โหมด",
  category: "ประเภท",
  status: "สถานะ",
  startAt: "เริ่ม",
  endAt: "สิ้นสุด",
  ownerId: "ผู้รับผิดชอบ",
  source: "แหล่งข้อมูล",
  visibility: "การเผยแพร่",
  riskLevel: "ความเสี่ยง",
  blockedReason: "สิ่งที่ติดขัด",
  notes: "โน้ตภายใน",
  game: "เกม",
  matchId: "Match ID",
  teams: "ทีม",
  venue: "สถานที่",
  streamPlatform: "แพลตฟอร์มสตรีม",
  scoreboardUrl: "ลิงก์ Scoreboard",
  meetingLink: "ลิงก์ประชุม",
  agenda: "วาระ",
  feature: "ฟีเจอร์/Release",
  environment: "Environment",
  departmentIds: "ฝ่ายที่เกี่ยวข้อง",
  lastConfirmedAt: "ยืนยันล่าสุด",
  lastConfirmedById: "ผู้ยืนยัน",
  archivedAt: "เก็บถาวร",
  approvedAt: "อนุมัติ",
  duplicatedFrom: "สำเนาจาก",
  duplicatedTo: "ทำสำเนาไปที่",
};

export type ItemFlag = { key: string; label: string; className: string };

/** The badges that warn at a glance: TBD, blocked, at risk, live, released, cancelled. */
export function itemFlags(item: CalendarItem): ItemFlag[] {
  const flags: ItemFlag[] = [];
  if (item.status === "live") {
    flags.push({ key: "live", label: "Live", className: "bg-red-600 text-white" });
  }
  if (item.status === "released") {
    flags.push({ key: "released", label: "Released", className: "bg-emerald-600 text-white" });
  }
  if (item.status === "cancelled") {
    flags.push({ key: "cancelled", label: "ยกเลิก", className: "bg-muted text-muted-foreground" });
  }
  if (item.tbd) {
    flags.push({
      key: "tbd",
      label: "TBD",
      className: "border border-dashed border-foreground/40 text-foreground",
    });
  }
  if (item.blockedReason) {
    flags.push({ key: "blocked", label: "Blocked", className: "bg-destructive text-white" });
  }
  if (item.riskLevel === "high") {
    flags.push({ key: "risk", label: "At risk", className: "bg-amber-500 text-black" });
  }
  return flags;
}

/** Live operations the run sheet and "next live block" jump look for. */
export const LIVE_CATEGORIES: readonly CalendarCategory[] = ["match", "broadcast"];
