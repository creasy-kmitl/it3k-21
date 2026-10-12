import { Badge } from "@it3k/ui/components/badge";
import { cn } from "@it3k/ui/lib/utils";
import {
  Bus,
  Calendar,
  Camera,
  Clapperboard,
  ClipboardList,
  Flag,
  Folder,
  Handshake,
  HeartHandshake,
  type LucideIcon,
  MapPin,
  Megaphone,
  Mic,
  MonitorPlay,
  Music,
  Package,
  Palette,
  Radio,
  Shield,
  Shirt,
  Sparkles,
  Star,
  Stethoscope,
  Trophy,
  Users,
  Utensils,
  Wallet,
} from "lucide-react";

import type { LeadershipDepartment } from "@/lib/leadership";

export type DepartmentIconKey = LeadershipDepartment["icon"];
export type DepartmentColorKey = LeadershipDepartment["color"];

// Keyed by the server's enums, so a key added there fails to type-check here.
export const DEPARTMENT_ICONS: Record<DepartmentIconKey, LucideIcon> = {
  folder: Folder,
  "heart-handshake": HeartHandshake,
  "map-pin": MapPin,
  mic: Mic,
  flag: Flag,
  package: Package,
  stethoscope: Stethoscope,
  radio: Radio,
  "clipboard-list": ClipboardList,
  trophy: Trophy,
  wallet: Wallet,
  handshake: Handshake,
  clapperboard: Clapperboard,
  megaphone: Megaphone,
  shirt: Shirt,
  palette: Palette,
  "monitor-play": MonitorPlay,
  users: Users,
  star: Star,
  calendar: Calendar,
  camera: Camera,
  music: Music,
  utensils: Utensils,
  bus: Bus,
  shield: Shield,
  sparkles: Sparkles,
};

// Full class names so Tailwind can see them.
export const DEPARTMENT_COLORS: Record<DepartmentColorKey, string> = {
  slate: "bg-slate-500/15 text-slate-600 dark:text-slate-300",
  red: "bg-red-500/15 text-red-600 dark:text-red-400",
  orange: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  yellow: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  lime: "bg-lime-500/15 text-lime-600 dark:text-lime-400",
  green: "bg-green-500/15 text-green-600 dark:text-green-400",
  emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  teal: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
  cyan: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  sky: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  blue: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  indigo: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  violet: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  purple: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  fuchsia: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
  pink: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
  rose: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
};

export const DEPARTMENT_ICON_KEYS = Object.keys(DEPARTMENT_ICONS) as DepartmentIconKey[];
export const DEPARTMENT_COLOR_KEYS = Object.keys(DEPARTMENT_COLORS) as DepartmentColorKey[];

type Appearance = { icon: DepartmentIconKey; color: DepartmentColorKey };

/** The department's icon on a tinted square. Decorative; pair it with the name. */
export function DepartmentIcon({
  department,
  className,
}: {
  department: Appearance | undefined;
  className?: string;
}) {
  // Unknown keys (e.g. a tab older than the server's list) fall back rather than crash.
  const Icon = (department && DEPARTMENT_ICONS[department.icon]) ?? Folder;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-lg [&_svg]:size-3.5",
        (department && DEPARTMENT_COLORS[department.color]) ?? DEPARTMENT_COLORS.slate,
        className,
      )}
    >
      <Icon />
    </span>
  );
}

/** Icon plus name, for select items and headings. */
export function DepartmentLabel({ department }: { department: Appearance & { name: string } }) {
  return (
    <span className="flex items-center gap-2">
      <DepartmentIcon department={department} />
      {department.name}
    </span>
  );
}

/** The department name on its own color, with its icon. */
export function DepartmentBadge({
  department,
  className,
}: {
  department: Appearance & { name: string };
  className?: string;
}) {
  const Icon = DEPARTMENT_ICONS[department.icon] ?? Folder;
  return (
    <Badge
      className={cn(DEPARTMENT_COLORS[department.color] ?? DEPARTMENT_COLORS.slate, className)}
    >
      <Icon data-icon="inline-start" />
      {department.name}
    </Badge>
  );
}
