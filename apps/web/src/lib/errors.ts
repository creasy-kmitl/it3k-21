import { toast } from "sonner";

import { ApiError, isAccountChanged } from "./leadership";

/** What went wrong, from the point of view of the person using the page. */
export type ErrorKind =
  | "offline"
  | "network"
  | "outdated"
  | "signedOut"
  | "accountChanged"
  | "forbidden"
  | "notFound"
  | "stale"
  | "invalid"
  | "rateLimited"
  | "server"
  | "unknown";

/** The one thing the page should offer next. */
export type ErrorAction = "retry" | "reload" | "signIn" | "home" | "none";

export type ErrorInfo = {
  kind: ErrorKind;
  /** A short Thai heading. */
  title: string;
  /** A full Thai sentence: the cause and what to do. */
  description: string;
  /** The raw text (status, English server message), for bug reports only. */
  detail?: string;
  retryable: boolean;
  action: ErrorAction;
};

const COPY: Record<ErrorKind, Omit<ErrorInfo, "kind" | "detail">> = {
  offline: {
    title: "ไม่มีการเชื่อมต่ออินเทอร์เน็ต",
    description: "อุปกรณ์ไม่ได้เชื่อมต่ออินเทอร์เน็ต ระบบจะลองใหม่ให้เองเมื่อกลับมาออนไลน์",
    retryable: true,
    action: "retry",
  },
  network: {
    title: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้",
    description: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ เครือข่ายอาจไม่เสถียรหรือระบบกำลังอัปเดต ลองอีกครั้งในอีกสักครู่",
    retryable: true,
    action: "retry",
  },
  outdated: {
    title: "ระบบมีเวอร์ชันใหม่",
    description: "หน้านี้เปิดค้างไว้ก่อนระบบอัปเดต โหลดหน้าใหม่เพื่อใช้งานต่อ",
    retryable: false,
    action: "reload",
  },
  signedOut: {
    title: "เซสชันหมดอายุ",
    description: "เซสชันหมดอายุแล้ว กรุณาเข้าสู่ระบบอีกครั้งเพื่อทำต่อ",
    retryable: false,
    action: "signIn",
  },
  accountChanged: {
    title: "บัญชีที่เข้าสู่ระบบเปลี่ยนไป",
    description: "เบราว์เซอร์นี้เข้าสู่ระบบด้วยบัญชีอื่นแล้ว โหลดหน้าใหม่เพื่อใช้บัญชีปัจจุบัน",
    retryable: false,
    action: "reload",
  },
  forbidden: {
    title: "ไม่มีสิทธิ์เข้าถึง",
    description: "บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้ หากคิดว่าผิดพลาด ติดต่อผู้ดูแลระบบ",
    retryable: false,
    action: "home",
  },
  notFound: {
    title: "ไม่พบข้อมูล",
    description: "ไม่พบข้อมูลนี้ อาจถูกลบหรือย้ายไปแล้ว",
    retryable: false,
    action: "home",
  },
  stale: {
    title: "ข้อมูลถูกแก้ไขไปแล้ว",
    description: "มีคนแก้ไขข้อมูลนี้ก่อนคุณ โหลดข้อมูลล่าสุดแล้วลองอีกครั้ง",
    retryable: true,
    action: "retry",
  },
  invalid: {
    title: "ข้อมูลไม่ถูกต้อง",
    description: "ข้อมูลบางส่วนไม่ถูกต้อง ตรวจสอบแล้วลองอีกครั้ง",
    retryable: false,
    action: "none",
  },
  rateLimited: {
    title: "ส่งคำขอถี่เกินไป",
    description: "ส่งคำขอถี่เกินไป รอสักครู่แล้วลองอีกครั้ง",
    retryable: true,
    action: "retry",
  },
  server: {
    title: "ระบบขัดข้องชั่วคราว",
    description: "เซิร์ฟเวอร์ขัดข้องชั่วคราว ลองอีกครั้งในอีกสักครู่",
    retryable: true,
    action: "retry",
  },
  unknown: {
    title: "เกิดข้อผิดพลาด",
    description: "เกิดข้อผิดพลาดที่ไม่คาดคิด ลองอีกครั้ง หากยังไม่หายให้โหลดหน้าใหม่",
    retryable: true,
    action: "retry",
  },
};

const THAI = /[฀-๿]/;

/** Browsers word a failed `fetch()` differently: Chrome, Safari, Firefox. */
const NETWORK = /failed to fetch|load failed|networkerror|network request failed|fetch failed/i;

/** A lazy route chunk that a newer deploy has replaced. */
const OUTDATED =
  /dynamically imported module|importing a module script failed|error loading dynamically imported|unable to preload css|loading chunk .* failed/i;

function kindOfStatus(status: number): ErrorKind {
  if (status === 401) return "signedOut";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 409) return "stale";
  if (status === 400 || status === 422) return "invalid";
  if (status === 429) return "rateLimited";
  if (status >= 500) return "server";
  return "unknown";
}

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** Turns any thrown value into Thai copy and the next step to offer. */
export function describeError(error: unknown): ErrorInfo {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);
  const make = (kind: ErrorKind, own?: string, detail?: string): ErrorInfo => ({
    kind,
    ...COPY[kind],
    ...(own ? { description: own } : {}),
    ...(detail ? { detail } : {}),
  });

  if (error instanceof ApiError) {
    const kind = isAccountChanged(error) ? "accountChanged" : kindOfStatus(error.status);
    // A Thai reason that only repeats the heading adds nothing; keep the fuller copy.
    const own =
      THAI.test(error.message) && error.message !== COPY[kind].title ? error.message : undefined;
    return make(kind, own, `HTTP ${error.status}: ${error.message}`);
  }
  if (OUTDATED.test(message)) return make("outdated", undefined, message);
  if (isOffline()) return make("offline", undefined, message);
  if (error instanceof TypeError && NETWORK.test(message))
    return make("network", undefined, message);
  if (THAI.test(message)) return { ...make("unknown", message), title: "ดำเนินการไม่สำเร็จ" };
  return make("unknown", undefined, message || undefined);
}

/**
 * The description to show under `heading`, without repeating it: copy such as
 * "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ เครือข่าย…" opens with its own title, which reads
 * twice when the title is also the heading.
 */
export function bodyUnder(info: ErrorInfo, heading: string) {
  return heading === info.title && info.description.startsWith(info.title)
    ? info.description.slice(info.title.length).trim() || info.description
    : info.description;
}

/** Worth trying the same request again without the person changing anything. */
export function isRetryable(error: unknown) {
  return describeError(error).retryable;
}

/**
 * Reports a failed action in a toast: `context` says what failed ("บันทึกไม่สำเร็จ"),
 * the description says why in Thai. Pass `retry` to offer a "ลองอีกครั้ง" button.
 */
export function toastError(error: unknown, context?: string, retry?: () => unknown) {
  const info = describeError(error);
  const heading = context ?? info.title;
  return toast.error(heading, {
    description: bodyUnder(info, heading),
    ...(retry && info.retryable
      ? { action: { label: "ลองอีกครั้ง", onClick: () => void retry() } }
      : {}),
  });
}
