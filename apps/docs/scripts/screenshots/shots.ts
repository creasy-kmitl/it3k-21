import type { Page } from "playwright-core";

import type { PersonaKey } from "./personas";

/**
 * Every screenshot in the guide. `file` is the path under
 * apps/docs/public/screenshots (without extension) that MDX pages pass to
 * `<Screenshot src="…">`; `-mobile` is appended for the phone capture.
 */
export type Shot = {
  file: string;
  /** Signed in as this persona; omit for a signed-out visitor. */
  as?: PersonaKey;
  path: string;
  /** Desktop capture (default true). */
  desktop?: boolean;
  /** Also capture at phone size. */
  mobile?: boolean;
  /** Only the staff sidebar, to compare menus between roles. */
  sidebar?: boolean;
  /** Steps after the page settles: open a dialog, switch a tab… */
  act?: (page: Page) => Promise<void>;
  /** Capture the whole scrolling page instead of the first screen. */
  fullPage?: boolean;
  /** Extra CSS for this shot, e.g. to blank the kiosk's fake camera. */
  css?: string;
};

const click = (name: string | RegExp, role: "button" | "tab" | "link" | "menuitem" = "button") =>
  async (page: Page) => {
    await page.getByRole(role, { name }).first().click();
    await page.waitForTimeout(600);
  };

/** Types into the page's search box. */
const search = (text: string) => async (page: Page) => {
  await page.getByPlaceholder(/ค้นหา/).first().fill(text);
  await page.waitForTimeout(700);
};

/** Opens the account dropdown inside `scope`. */
const openMenu = (scope: string) => async (page: Page) => {
  await page.locator(`${scope} [aria-haspopup="menu"]`).last().click();
  await page.waitForTimeout(500);
};

export const SHOTS: Shot[] = [
  // Signed out
  { file: "public/home", path: "/", mobile: true },
  { file: "public/login", path: "/login", mobile: true },

  // Guest
  { file: "guest/signup", as: "guest", path: "/signup", mobile: true },
  { file: "guest/pending", as: "guest", path: "/pending", mobile: true },
  { file: "guest/home", as: "guest", path: "/", mobile: true },

  // Participant
  { file: "participant/me", as: "participant", path: "/me", mobile: true },
  { file: "participant/home", as: "participant", path: "/", mobile: true },
  { file: "participant/events", as: "participant", path: "/events", mobile: true },
  { file: "participant/event", as: "participant", path: "/events/opening-ceremony", mobile: true },
  { file: "participant/event-claim", as: "participant", path: "/events/closing-party", mobile: true, desktop: false },
  { file: "participant/my-tickets", as: "participant", path: "/me/tickets", mobile: true },
  { file: "participant/ticket", as: "participant", path: "/tickets/football-group-a", mobile: true },
  { file: "participant/profile-edit", as: "participant", path: "/signup", mobile: true },
  { file: "participant/menu", as: "participant", path: "/me", mobile: true, act: openMenu("header") },

  // Athlete
  { file: "athlete/sports", as: "athlete", path: "/sports", mobile: true },
  { file: "athlete/sports-register", as: "athlete", path: "/sports", mobile: true, act: click(/^สมัครกีฬา$/) },
  { file: "athlete/me", as: "athlete", path: "/me", mobile: true },

  // Other departments: Art
  { file: "art-staff/sidebar", as: "artStaff", path: "/staff/dashboard", sidebar: true },
  { file: "art-staff/dashboard", as: "artStaff", path: "/staff/dashboard" },
  { file: "art-staff/calendar", as: "artStaff", path: "/staff/calendar" },
  { file: "art-staff/head", as: "artStaff", path: "/staff/head" },
  { file: "art-staff/links", as: "artStaff", path: "/staff/links" },
  { file: "art-staff/links-create", as: "artStaff", path: "/staff/links", act: click("สร้างลิงก์", "button") },
  { file: "art-staff/qr-code", as: "artStaff", path: "/staff/qr-code" },
  { file: "art-staff/menu", as: "artStaff", path: "/staff/dashboard", act: openMenu("[data-sidebar='footer']") },
  { file: "art-head/sidebar", as: "artHead", path: "/staff/dashboard", sidebar: true },
  { file: "art-head/head", as: "artHead", path: "/staff/head", act: search("Art") },
  { file: "art-head/head-edit", as: "artHead", path: "/staff/head", act: async (page) => {
    await search("Art")(page);
    await click(/^แก้ไข .*วรเมธ/)(page);
  } },
  { file: "art-staff/calendar-new", as: "artStaff", path: "/staff/calendar", act: click(/^เพิ่มรายการ$/) },

  // Tech/Live
  { file: "tech-staff/sidebar", as: "techStaff", path: "/staff/dashboard", sidebar: true },
  { file: "tech-staff/users", as: "techStaff", path: "/staff/users" },
  { file: "tech-staff/athletes", as: "techStaff", path: "/staff/athletes" },
  { file: "tech-staff/email", as: "techStaff", path: "/staff/email" },
  { file: "tech-staff/event", as: "techStaff", path: "/staff/events/demo-event-opening" },
  { file: "tech-staff/scan", as: "techStaff", path: "/staff/events/demo-event-opening", act: click("สแกนเช็คอิน"), css: "video { visibility: hidden; }" },
  { file: "tech-staff/kiosk", as: "techStaff", path: "/kiosk/opening-ceremony", css: "video { visibility: hidden; }" },
  { file: "tech-head/sidebar", as: "techHead", path: "/staff/dashboard", sidebar: true },
  { file: "tech-head/users", as: "techHead", path: "/staff/users" },
  { file: "tech-head/invite", as: "techHead", path: "/staff/users", act: click("เชิญผู้ใช้") },
  { file: "tech-head/user-edit", as: "techHead", path: "/staff/users", act: click("แก้ไข กฤษดา วงศ์ทอง") },
  { file: "tech-staff/user-edit", as: "techStaff", path: "/staff/users", act: click("แก้ไข ธนกร ศรีสุข") },
  { file: "tech-head/head-add", as: "techHead", path: "/staff/head", act: click("เพิ่มตำแหน่ง") },
  { file: "tech-head/event-add", as: "techHead", path: "/staff/events", act: click("เพิ่มกิจกรรม") },
  { file: "tech-head/head", as: "techHead", path: "/staff/head" },
  { file: "tech-head/sports", as: "techHead", path: "/staff/sports" },
  { file: "tech-head/events", as: "techHead", path: "/staff/events" },
  { file: "tech-head/event-edit", as: "techHead", path: "/staff/events/demo-event-opening", act: click("แก้ไข", "tab") },
  { file: "tech-head/event-edit-full", as: "techHead", path: "/staff/events/demo-event-opening", fullPage: true, act: click("แก้ไข", "tab") },
  { file: "tech-head/venues", as: "techHead", path: "/staff/venues" },
  { file: "tech-head/email", as: "techHead", path: "/staff/email" },

  // ทะเบียน
  { file: "reg-staff/sidebar", as: "regStaff", path: "/staff/dashboard", sidebar: true },
  { file: "reg-staff/athletes", as: "regStaff", path: "/staff/athletes" },
  { file: "reg-staff/users", as: "regStaff", path: "/staff/users" },
  { file: "reg-other/sidebar", as: "regOther", path: "/staff/dashboard", sidebar: true },
  { file: "reg-other/athletes", as: "regOther", path: "/staff/athletes" },
  { file: "reg-head/sidebar", as: "regHead", path: "/staff/dashboard", sidebar: true },
  { file: "reg-head/athletes", as: "regHead", path: "/staff/athletes" },
  { file: "reg-head/departments", as: "regHead", path: "/staff/departments" },
  { file: "reg-head/athlete-reject", as: "regHead", path: "/staff/athletes", act: click(/^ไม่อนุมัติ กฤษดา/) },
  { file: "reg-head/athlete-edit", as: "regHead", path: "/staff/athletes", act: async (page) => {
    await click(/^ตัวเลือกเพิ่มเติม กฤษดา วงศ์ทอง แบดมินตัน/)(page);
    await click("แก้ไขข้อมูล", "menuitem")(page);
  } },
  { file: "reg-head/athletes-bulk", as: "regHead", path: "/staff/athletes", act: async (page) => {
    const boxes = page.getByRole("checkbox", { name: /^เลือก (?!ทั้งหน้า)/ });
    for (const n of [0, 1, 2]) await boxes.nth(n).click();
    await page.waitForTimeout(600);
  } },
  { file: "reg-head/athletes-export", as: "regHead", path: "/staff/athletes", act: click(/^ส่งออก CSV/) },
  { file: "reg-head/email", as: "regHead", path: "/staff/email", fullPage: true },

  // Competition (Tech/Live leaders run the whole sport system)
  { file: "tech-head/matches-bracket", as: "techHead", path: "/staff/matches" },
  { file: "tech-head/bracket-builder", as: "techHead", path: "/staff/matches", act: click(/^เพิ่มสายการแข่ง$/) },
  { file: "public/matches-bracket", path: "/matches?view=bracket" },
  // Sport ids are random per database, so open the first sport's rules from its card.
  { file: "tech-head/sport-rules", as: "techHead", path: "/staff/sports", act: async (page) => {
    // Base UI renders the link with role="button".
    await click(/^กติกา$/)(page);
    await page.waitForURL(/\/rules$/);
    await page.waitForTimeout(800);
  } },
  { file: "tech-head/teams-auto", as: "techHead", path: "/staff/teams", act: click(/จัดทีมอัตโนมัติทุกประเภท/) },
  { file: "tech-head/competition-settings", as: "techHead", path: "/staff/teams", act: async (page) => {
    await click(/^ตั้งค่าการแข่งขัน แบดมินตัน/)(page);
    await page.waitForURL(/\/staff\/competition\//);
    await page.waitForTimeout(800);
  } },
  { file: "tech-head/match-detail", as: "techHead", path: "/staff/matches/demo-match-sf2" },
  { file: "tech-head/match-checkin", as: "techHead", path: "/staff/match-checkin" },
  { file: "tech-head/match-kiosk", as: "techHead", path: "/kiosk/matches/demo-venue-gym", css: "video { visibility: hidden; }" },
  { file: "public/match", path: "/matches/demo-match-sf1", mobile: true },
  { file: "public/live", path: "/live" },

  // ฝ่ายกีฬา
  { file: "sports-staff/sidebar", as: "sportsStaff", path: "/staff/dashboard", sidebar: true },
  { file: "sports-head/sidebar", as: "sportsHead", path: "/staff/dashboard", sidebar: true },
  { file: "sports-staff/scoring", as: "sportsStaff", path: "/score/demo-match-sf2", mobile: true },

  // Admin
  { file: "admin/sidebar", as: "admin", path: "/staff/dashboard", sidebar: true },
  { file: "admin/users", as: "admin", path: "/staff/users" },
  { file: "admin/view-as", as: "admin", path: "/staff/dashboard", act: async (page) => {
    await openMenu("[data-sidebar='footer']")(page);
    await page.getByRole("menuitem", { name: /จำลองมุมมอง/ }).click();
    await page.waitForTimeout(600);
  } },
];
