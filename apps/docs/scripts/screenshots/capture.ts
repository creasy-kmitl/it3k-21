/**
 * Takes the guide's screenshots with the local Chrome, signed in as the demo
 * personas that seed.ts created. Needs `bun run dev` running and `cwebp`
 * (`brew install webp`).
 *
 *   bun run --cwd apps/docs screenshots            # every shot
 *   bun run --cwd apps/docs screenshots tech-head  # shots whose file contains "tech-head"
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { type BrowserContext, chromium } from "playwright-core";

import { PERSONAS, SESSIONS_FILE, type PersonaKey } from "./personas";
import { SESSION_COOKIE, WEB_URL, readAuthSecret, signedSessionCookie } from "./session";
import { SHOTS, type Shot } from "./shots";

const OUT = resolve(import.meta.dirname, "../../public/screenshots");
const filter = process.argv[2];

if (!existsSync(SESSIONS_FILE)) {
  console.error("No sessions file; run seed.ts first.");
  process.exit(1);
}
const sessions = JSON.parse(readFileSync(SESSIONS_FILE, "utf8")) as Record<string, string>;
const secret = readAuthSecret();

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  // The kiosk asks for the camera; give it Chrome's fake one.
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
} as const;

async function context(as: PersonaKey | undefined, kind: keyof typeof VIEWPORTS) {
  const ctx = await browser.newContext({
    ...VIEWPORTS[kind],
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
    colorScheme: "light",
    permissions: ["camera"],
  });
  if (as) {
    const token = sessions[PERSONAS[as].id];
    if (!token) throw new Error(`No session for ${as}; re-run seed.ts`);
    await ctx.addCookies([
      {
        name: SESSION_COOKIE,
        value: await signedSessionCookie(token, secret),
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  }
  return ctx;
}

async function take(ctx: BrowserContext, shot: Shot, suffix: string) {
  const page = await ctx.newPage();
  await page.goto(`${WEB_URL}${shot.path}`, { waitUntil: "networkidle" });
  // Let fonts, images and enter animations settle.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  if (shot.act) await shot.act(page);
  // Hide toasts and the TanStack devtools badges.
  await page.addStyleTag({
    content: `[data-sonner-toaster], .tsqd-parent-container, .TanStackRouterDevtools { display: none !important; } ${shot.css ?? ""}`,
  });

  const png = resolve(OUT, `${shot.file}${suffix}.png`);
  mkdirSync(dirname(png), { recursive: true });
  if (shot.sidebar) {
    const sidebar = page.locator("[data-slot='sidebar-container'], [data-sidebar='sidebar']").first();
    await sidebar.screenshot({ path: png });
  } else {
    await page.screenshot({ path: png, fullPage: shot.fullPage ?? false });
  }
  await page.close();

  const webp = png.replace(/\.png$/, ".webp");
  execFileSync("cwebp", ["-quiet", "-q", "88", png, "-o", webp]);
  rmSync(png);
  console.log(`✓ ${shot.file}${suffix}`);
}

const shots = SHOTS.filter((s) => !filter || s.file.includes(filter));
const failures: string[] = [];
for (const shot of shots) {
  for (const kind of ["desktop", "mobile"] as const) {
    if (kind === "desktop" && shot.desktop === false) continue;
    if (kind === "mobile" && !shot.mobile) continue;
    const ctx = await context(shot.as, kind);
    try {
      await take(ctx, shot, kind === "mobile" ? "-mobile" : "");
    } catch (error) {
      failures.push(`${shot.file} (${kind}): ${(error as Error).message.split("\n")[0]}`);
      console.error(`✗ ${shot.file} (${kind})`);
    } finally {
      await ctx.close();
    }
  }
}
await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.join("\n")}`);
  process.exit(1);
}
