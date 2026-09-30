import {
  type ActionItemStatus,
  type CalendarCategory,
  type ConflictKind,
  type LiveChecklistKey,
  type QaResult,
  type ReleaseEnvironment,
  type CalendarChangeAction,
  type CalendarMode,
  type CalendarStatus,
  type CalendarVisibility,
  type Game,
  type RepeatUnit,
  type RequestState,
  type RiskLevel,
  LIVE_CHECKLIST,
} from "@it3k/db/calendar-rules";

import { formatBangkok } from "./bangkok-time";
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
  request: "ขอข้อมูลจากฝ่าย",
  answer: "ฝ่ายตอบกลับ",
  action_item: "Action item",
  decision: "บันทึกการตัดสินใจ",
  checklist: "Checklist ไลฟ์",
  release_approval: "อนุมัติ release",
  dependency: "Dependency",
};

export const REQUEST_STATE_LABELS: Record<RequestState, string> = {
  involved: "เกี่ยวข้อง",
  requested: "รอข้อมูล",
  answered: "ตอบแล้ว",
};

export const REQUEST_STATE_STYLES: Record<RequestState, string> = {
  involved: "bg-muted text-muted-foreground",
  requested: "bg-amber-500 text-black",
  answered: "bg-emerald-600 text-white",
};

export const ACTION_STATUS_LABELS: Record<ActionItemStatus, string> = {
  open: "ยังไม่เสร็จ",
  done: "เสร็จแล้ว",
};

export const REPEAT_LABELS: Record<RepeatUnit, string> = {
  day: "ทุกวัน",
  week: "ทุกสัปดาห์",
};

/** Agenda outlines for the Tech team's rituals; picking one fills the agenda. */
export const MEETING_TEMPLATES = {
  planning: {
    label: "Planning",
    agenda: "1. Priority\n2. Owner\n3. Deadline\n4. Risk",
  },
  rehearsal: {
    label: "Tech rehearsal",
    agenda: "1. Network\n2. Audio\n3. Overlay\n4. Stream\n5. Scoreboard\n6. Backup plan",
  },
  checkIn: {
    label: "Event-day check-in",
    agenda: "1. Live block ถัดไป\n2. On-call\n3. Blockers\n4. Escalation",
  },
  retro: {
    label: "Retro",
    agenda: "1. Incident\n2. Root cause\n3. Action item\n4. Owner\n5. วันติดตามผล",
  },
} as const;

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
  department: "ฝ่าย",
  requestState: "สถานะคำขอ",
  request: "สิ่งที่ขอ",
  contactUserId: "ผู้ตอบของฝ่าย",
  dueAt: "กำหนดส่ง",
  response: "คำตอบ",
  actionItem: "Action item",
  departmentId: "ฝ่ายที่รับผิดชอบ",
  decision: "การตัดสินใจ",
  onCallOwnerId: "On-call",
  scoreboardOperatorId: "คนคุม Scoreboard",
  mitigation: "แผนรับมือการชน",
  conflicts: "ชนกับ",
  specUrl: "ลิงก์ spec",
  designUrl: "ลิงก์ design",
  pullRequestUrl: "Pull request",
  qaUrl: "ลิงก์ผล QA",
  incidentUrl: "ลิงก์ incident",
  qaResult: "ผล QA",
  rolloutPlan: "Rollout checklist",
  rollbackPlan: "แผน rollback",
  monitoringOwnerId: "ผู้ดูแลการ monitor",
  releaseApprovedAt: "อนุมัติ release",
  releaseApprovedById: "ผู้อนุมัติ release",
  dependsOn: "รอรายการ",
  impact: "ผลกระทบ",
};

export const CHECKLIST_LABELS: Record<LiveChecklistKey, string> = {
  network: "Network และ backup path",
  audio: "Audio เข้า/ออก และ monitor",
  overlay: "Scene, overlay และ asset",
  stream: "Stream preview และสถานะแพลตฟอร์ม",
  scoreboard: "Scoreboard และการประกาศผล",
  backup: "อุปกรณ์/คนสำรอง และผู้ติดต่อ escalate",
  times: "เวลาเริ่ม/จบไลฟ์ที่ยืนยันแล้ว",
};

export const CONFLICT_KIND_LABELS: Record<ConflictKind, string> = {
  person: "คนเดียวกัน",
  venue: "สถานที่เดียวกัน",
  stream: "ช่องสตรีมเดียวกัน",
  release_window: "ช่วง release ทับช่วงไลฟ์",
};

export const RELEASE_ENVIRONMENT_LABELS: Record<ReleaseEnvironment, string> = {
  preview: "Preview",
  staging: "Staging",
  prod: "Production",
};

export const QA_RESULT_LABELS: Record<QaResult, string> = {
  passed: "ผ่าน",
  failed: "ไม่ผ่าน",
};

const RELEASE_MISSING_LABELS: Record<string, string> = {
  environment: "environment",
  qa: "ผล QA ที่ผ่าน",
  approval: "การอนุมัติ release",
  rollbackPlan: "แผน rollback",
  monitoringOwner: "ผู้ดูแลการ monitor",
  dependencies: "dependency ที่เสร็จครบ",
};

/**
 * The Thai explanation for a release the API refused to mark released, or
 * null when the error is something else.
 */
export function releaseMessage(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("missing" in body)) return null;
  const missing = (body as { missing: unknown }).missing;
  if (!Array.isArray(missing) || !missing.every((key) => String(key) in RELEASE_MISSING_LABELS)) {
    return null;
  }
  const labels = missing.map((key) => RELEASE_MISSING_LABELS[String(key)]);
  return `ยังตั้งเป็น Released ไม่ได้ ต้องมี${labels.join(", ")}ก่อน`;
}

/**
 * The Thai explanation for an item the API refused to mark ready or live,
 * or null when the error is something else.
 */
export function readinessMessage(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("missing" in body)) return null;
  const missing = (body as { missing: unknown }).missing;
  if (
    !Array.isArray(missing) ||
    !missing.every((key) => key === "onCall" || key in CHECKLIST_LABELS)
  ) {
    return null;
  }
  const labels = missing.map((key) =>
    key === "onCall" ? "ผู้รับผิดชอบ on-call" : CHECKLIST_LABELS[key as LiveChecklistKey],
  );
  return `ยังตั้งเป็นพร้อมหรือ Live ไม่ได้ ต้องมี${labels.join(", ")}ก่อน`;
}

export const LIVE_CHECKLIST_SIZE = LIVE_CHECKLIST.length;

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
  if (
    item.checklistDone !== null &&
    item.checklistDone < LIVE_CHECKLIST_SIZE &&
    (item.status === "ready" || item.status === "live")
  ) {
    flags.push({
      key: "checklist",
      label: `Checklist ${item.checklistDone}/${LIVE_CHECKLIST_SIZE}`,
      className: "bg-destructive text-white",
    });
  }
  if (item.waitingOn > 0) {
    flags.push({
      key: "waiting-on",
      label: `รอ ${item.waitingOn} รายการ`,
      className: "bg-destructive text-white",
    });
  }
  if (item.pendingRequests > 0) {
    flags.push({
      key: "waiting",
      label: `รอข้อมูล ${item.pendingRequests} ฝ่าย`,
      className: "bg-amber-200 text-amber-950 dark:bg-amber-900 dark:text-amber-100",
    });
  }
  if (item.riskLevel === "high") {
    flags.push({ key: "risk", label: "At risk", className: "bg-amber-500 text-black" });
  }
  return flags;
}

/** Live operations the run sheet and "next live block" jump look for. */
export const LIVE_CATEGORIES: readonly CalendarCategory[] = ["match", "broadcast"];

const CLOSE_OUT_LABELS: Record<string, string> = {
  agenda: "วาระ",
  owner: "ผู้รับผิดชอบ",
  departments: "ฝ่ายที่เกี่ยวข้อง",
  "decision or action item": "การตัดสินใจหรือ action item อย่างน้อยหนึ่งรายการ",
};

/**
 * The Thai explanation for a meeting or handoff the API refused to close, or
 * null when the error is something else.
 */
export function closeOutMessage(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("missing" in body)) return null;
  const missing = (body as { missing: unknown }).missing;
  // Readiness refusals also list what is `missing`; only close-out keys count here.
  if (!Array.isArray(missing) || !missing.every((key) => String(key) in CLOSE_OUT_LABELS)) {
    return null;
  }
  const labels = missing.map((key) => CLOSE_OUT_LABELS[String(key)] ?? String(key));
  return `ปิดรายการนี้ไม่ได้ ต้องมี${labels.join(", ")}ก่อน`;
}

const ROLE_LABELS: Record<string, string> = {
  ownerId: "ผู้รับผิดชอบ",
  onCallOwnerId: "on-call",
  scoreboardOperatorId: "คนคุม scoreboard",
  monitoringOwnerId: "ผู้ดูแลการ monitor",
};

type NoticeLike = { kind: string; itemTitle: string; data: Record<string, unknown> };

const when = (value: unknown) =>
  typeof value === "number" ? formatBangkok(value, "dateTime") : null;

/** A notification in one Thai sentence. */
export function describeNotification(notice: NoticeLike): string {
  const { data, itemTitle: title } = notice;
  const reason = typeof data.reason === "string" && data.reason ? ` (เหตุผล: ${data.reason})` : "";
  switch (notice.kind) {
    case "assignment": {
      const role = ROLE_LABELS[String(data.role ?? "ownerId")] ?? "ผู้รับผิดชอบ";
      const series = typeof data.series === "number" ? ` ทั้งชุด ${data.series} ครั้ง` : "";
      return `คุณเป็น${role}ของ "${title}"${series}${when(data.startAt) ? ` เริ่ม ${when(data.startAt)}` : ""}`;
    }
    case "reschedule":
      return `"${title}" ถูกเลื่อนเป็น ${when(data.startAt) ?? "เวลาใหม่"}${reason}`;
    case "cancel":
      return `"${title}" ถูกยกเลิก${reason}`;
    case "dependency":
      return data.change === "cancel"
        ? `"${title}" ที่งานของคุณรออยู่ถูกยกเลิก${reason}`
        : `"${title}" ที่งานของคุณรออยู่ถูกเลื่อนเป็น ${when(data.startAt) ?? "เวลาใหม่"}${reason}`;
    case "request":
      return `ฝ่าย${String(data.department ?? "")}ถูกขอข้อมูลใน "${title}": ${String(data.request ?? "")}${when(data.dueAt) ? ` ภายใน ${when(data.dueAt)}` : ""}`;
    case "action_item":
      return `คุณได้รับ action item "${String(data.title ?? "")}" จาก "${title}"${when(data.dueAt) ? ` ภายใน ${when(data.dueAt)}` : ""}`;
    case "release_risk":
      return data.approvalWithdrawn
        ? `การอนุมัติ release "${title}" ถูกถอน เพราะแผนเปลี่ยน`
        : `release "${title}" ทับช่วงไลฟ์: ${Array.isArray(data.conflicts) ? data.conflicts.join(", ") : ""}`;
    default:
      return title;
  }
}
