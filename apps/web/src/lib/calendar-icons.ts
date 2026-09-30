// One icon per calendar concept, so a status, action or notice looks the
// same everywhere it appears.
import type {
  CalendarChangeAction,
  CalendarStatus,
  CalendarVisibility,
  NotificationKind,
} from "@it3k/db/calendar-rules";
import {
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarSync,
  CalendarX,
  CircleCheck,
  CircleX,
  Globe,
  Handshake,
  History,
  Layers,
  List,
  ListFilter,
  Lock,
  type LucideIcon,
  Minus,
  PencilLine,
  Plus,
  SquarePen,
  Trash2,
  UserPlus,
  UserRound,
} from "lucide-react";

import type { CalendarView } from "@/components/calendar/calendar-toolbar";

export const VIEW_ICONS: Record<CalendarView, LucideIcon> = {
  month: CalendarDays,
  week: CalendarRange,
  day: CalendarClock,
  agenda: List,
};

/** Keyed by string: the change log keeps actions the calendar no longer has. */
export const ACTION_ICONS: Record<CalendarChangeAction, LucideIcon> &
  Record<string, LucideIcon | undefined> = {
  create: Plus,
  update: SquarePen,
  reschedule: CalendarSync,
  status: Layers,
  cancel: CalendarX,
  publish: Globe,
  delete: Trash2,
};

export const FALLBACK_ACTION_ICON: LucideIcon = History;

export const NOTIFICATION_ICONS: Record<NotificationKind, LucideIcon> = {
  assignment: UserPlus,
  collaboration: Handshake,
  reschedule: CalendarSync,
  cancel: CalendarX,
};

export const STATUS_ICONS: Record<CalendarStatus, LucideIcon> = {
  draft: PencilLine,
  confirmed: CircleCheck,
  cancelled: CircleX,
};

export const VISIBILITY_ICONS: Record<CalendarVisibility, LucideIcon> = {
  internal: Lock,
  public: Globe,
};

/** Options that mean "none", "all", a person or a department. */
export const OPTION_ICONS = {
  none: Minus,
  all: ListFilter,
  person: UserRound,
  department: Building2,
} satisfies Record<string, LucideIcon>;
