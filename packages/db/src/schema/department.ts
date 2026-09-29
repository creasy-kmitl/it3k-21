import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const DEPARTMENT_CODES = ["tech-live", "registration"] as const;
export type DepartmentCode = (typeof DEPARTMENT_CODES)[number];

// Keys the web app maps to lucide icons and palette classes.
export const DEPARTMENT_ICONS = [
  "folder",
  "heart-handshake",
  "map-pin",
  "mic",
  "flag",
  "package",
  "stethoscope",
  "radio",
  "clipboard-list",
  "trophy",
  "wallet",
  "handshake",
  "clapperboard",
  "megaphone",
  "shirt",
  "palette",
  "monitor-play",
  "users",
  "star",
  "calendar",
  "camera",
  "music",
  "utensils",
  "bus",
  "shield",
  "sparkles",
] as const;
export type DepartmentIcon = (typeof DEPARTMENT_ICONS)[number];

export const DEPARTMENT_COLORS = [
  "slate",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
] as const;
export type DepartmentColor = (typeof DEPARTMENT_COLORS)[number];

export type DepartmentAppearance = { icon: DepartmentIcon; color: DepartmentColor };

// Built-in look for the seeded departments, used until an admin picks one.
// Keyed by name, so a renamed department falls back to the generic look.
export const DEFAULT_DEPARTMENT_APPEARANCE: Record<string, DepartmentAppearance> = {
  สวัสดิการ: { icon: "heart-handshake", color: "pink" },
  สถานที่: { icon: "map-pin", color: "lime" },
  พิธีการ: { icon: "mic", color: "purple" },
  พาเหรด: { icon: "flag", color: "orange" },
  พัสดุ: { icon: "package", color: "amber" },
  พยาบาล: { icon: "stethoscope", color: "red" },
  ประสานงาน: { icon: "radio", color: "cyan" },
  ทะเบียน: { icon: "clipboard-list", color: "blue" },
  กีฬา: { icon: "trophy", color: "green" },
  การเงิน: { icon: "wallet", color: "emerald" },
  Sponsor: { icon: "handshake", color: "yellow" },
  Production: { icon: "clapperboard", color: "violet" },
  PR: { icon: "megaphone", color: "fuchsia" },
  Merchandise: { icon: "shirt", color: "teal" },
  Art: { icon: "palette", color: "rose" },
  "Tech/Live": { icon: "monitor-play", color: "indigo" },
};

const GENERIC_APPEARANCE: DepartmentAppearance = { icon: "folder", color: "slate" };

/** The stored icon and color, each falling back to the built-in default. */
export function departmentAppearance<
  T extends { name: string; icon: DepartmentIcon | null; color: DepartmentColor | null },
>(row: T): T & DepartmentAppearance {
  const fallback = DEFAULT_DEPARTMENT_APPEARANCE[row.name] ?? GENERIC_APPEARANCE;
  return { ...row, icon: row.icon ?? fallback.icon, color: row.color ?? fallback.color };
}

export const department = sqliteTable(
  "department",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull().unique(),
    description: text("description"),
    // Stable identity for departments the app treats specially; names can be
    // renamed by admins, codes cannot drift with them.
    code: text("code", { enum: DEPARTMENT_CODES }),
    // Null means "not chosen"; see departmentAppearance for what is shown then.
    icon: text("icon", { enum: DEPARTMENT_ICONS }),
    color: text("color", { enum: DEPARTMENT_COLORS }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("department_code_uidx").on(table.code)],
);
