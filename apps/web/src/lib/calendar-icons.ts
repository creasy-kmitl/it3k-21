// One icon per calendar concept, so a mode, category, badge or notice looks
// the same everywhere it appears.
import type {
  CalendarCategory,
  CalendarChangeAction,
  CalendarMode,
  ConflictKind,
  LiveChecklistKey,
  NotificationKind,
  PublicStatus,
} from "@it3k/db/calendar-rules";
import {
  Activity,
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  BadgeCheck,
  Ban,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  CalendarSync,
  CalendarX,
  CircleCheck,
  CircleDashed,
  CirclePlay,
  CircleX,
  ClipboardCheck,
  Code,
  Copy,
  FlaskConical,
  Gavel,
  GitBranch,
  GitPullRequest,
  Globe,
  Handshake,
  Headset,
  History,
  Hourglass,
  Layers,
  List,
  ListChecks,
  ListTodo,
  type LucideIcon,
  MapPin,
  Megaphone,
  MessageCircleQuestion,
  MessageSquareReply,
  MonitorPlay,
  Network,
  PenTool,
  Pencil,
  Plus,
  Presentation,
  Radio,
  RadioTower,
  Repeat,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  Siren,
  SquarePen,
  Swords,
  Timer,
  TriangleAlert,
  Trophy,
  Tv,
  UserPlus,
  Users,
  Volume2,
  Wrench,
} from "lucide-react";

import type { CalendarView } from "@/components/calendar/calendar-toolbar";

export const MODE_ICONS: Record<CalendarMode, LucideIcon> = {
  operations: RadioTower,
  coordination: Handshake,
  delivery: Rocket,
  meetings: Users,
};

export const CATEGORY_ICONS: Record<CalendarCategory, LucideIcon> = {
  match: Swords,
  broadcast: Tv,
  result_update: ClipboardCheck,
  technical_check: Wrench,
  rehearsal: Repeat,
  cross_team_meeting: Users,
  handoff: ArrowRightLeft,
  approval: BadgeCheck,
  information_request: MessageCircleQuestion,
  planning: ListTodo,
  design: PenTool,
  development: Code,
  code_review: GitPullRequest,
  qa: FlaskConical,
  release: Rocket,
  monitoring: Activity,
  incident: Siren,
  post_event_review: History,
};

/** Keyed like `itemFlags` in calendar-labels. */
export const FLAG_ICONS: Record<string, LucideIcon> = {
  live: Radio,
  released: Rocket,
  cancelled: CircleX,
  tbd: CircleDashed,
  blocked: Ban,
  risk: TriangleAlert,
  checklist: ListChecks,
  "waiting-on": GitBranch,
  waiting: Hourglass,
};

export const VIEW_ICONS: Record<CalendarView, LucideIcon> = {
  month: CalendarDays,
  week: CalendarRange,
  day: CalendarClock,
  agenda: List,
};

export const ACTION_ICONS: Record<CalendarChangeAction, LucideIcon> = {
  create: Plus,
  update: SquarePen,
  reschedule: CalendarSync,
  status: Layers,
  cancel: CalendarX,
  archive: Archive,
  unarchive: ArchiveRestore,
  duplicate: Copy,
  confirm: CircleCheck,
  publish: Globe,
  request: MessageCircleQuestion,
  answer: MessageSquareReply,
  action_item: ListTodo,
  decision: Gavel,
  checklist: ListChecks,
  release_approval: ShieldCheck,
  dependency: GitBranch,
};

export const NOTIFICATION_ICONS: Record<NotificationKind, LucideIcon> = {
  assignment: UserPlus,
  reschedule: CalendarSync,
  cancel: CalendarX,
  dependency: GitBranch,
  request: MessageCircleQuestion,
  action_item: ListTodo,
  release_risk: ShieldAlert,
};

export const CHECKLIST_ICONS: Record<LiveChecklistKey, LucideIcon> = {
  network: Network,
  audio: Volume2,
  overlay: Presentation,
  stream: MonitorPlay,
  scoreboard: Trophy,
  backup: Headset,
  times: Timer,
};

export const CONFLICT_ICONS: Record<ConflictKind, LucideIcon> = {
  person: Users,
  venue: MapPin,
  stream: Tv,
  release_window: Rocket,
};

export const PUBLIC_STATUS_ICONS: Record<PublicStatus, LucideIcon | null> = {
  scheduled: null,
  live: Radio,
  completed: CircleCheck,
  delayed: Hourglass,
  cancelled: CircleX,
};

/** Icons for the run sheet's slots and other one-off headings. */
export const SECTION_ICONS = {
  liveNow: Radio,
  nextLive: CirclePlay,
  nextMeeting: Users,
  nextRelease: Rocket,
  blockers: TriangleAlert,
  actionItems: ListTodo,
  edit: Pencil,
  announce: Megaphone,
} satisfies Record<string, LucideIcon>;
