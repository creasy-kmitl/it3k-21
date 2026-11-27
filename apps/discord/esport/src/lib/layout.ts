// What /init builds in the guild: roles, categories, channels and the panels
// the bot posts. Declarative and Discord-free, so it can be tested; setup.ts
// turns it into API calls. Every piece has a stable key under which its
// Discord id is stored, so a second run finds what the first one made.
// Names live here only: edit them here to restyle the server.
import { INSTITUTIONS, type Institution } from "@it3k/db/profile";

import { GAMES, type GameKey } from "./games";

export type TicketScope = "general" | GameKey;

export type RoleKey = "staff" | `game:${GameKey}` | `team:${GameKey}:${Institution}`;
/** Who an overwrite is for: everyone, or one of the roles /init makes. */
export type Audience = "everyone" | RoleKey;

/**
 * What an audience may do in a channel.
 * - hidden: cannot see it
 * - read: sees and reads, cannot post (announcements, rules, panels)
 * - write: talks there (text, voice, forum posts)
 * - ticket: reads, and talks only inside the ticket threads the bot opens
 * - manage: write, plus handles threads and messages (staff in ticket channels)
 */
export type Access = "hidden" | "read" | "write" | "ticket" | "manage";

export type Panel = "honeypot" | "welcome" | "verify" | `ticket:${TicketScope}`;

export type RoleSpec = { key: RoleKey; name: string; color: number; hoist: boolean };

export type ChannelSpec = {
  /** Stored as-is; also the key's prefix tells a category (`category:`) from a channel. */
  key: string;
  kind: "category" | "text" | "voice" | "forum";
  name: string;
  /** The category's key, if any. */
  parent?: string;
  topic?: string;
  access: Partial<Record<Audience, Access>>;
  /** The message the bot keeps posted in the channel, if any. */
  panel?: Panel;
};

export type Layout = { roles: RoleSpec[]; channels: ChannelSpec[] };

export const roleStoreKey = (key: RoleKey) => `role:${key}`;
export const panelStoreKey = (channelKey: string) => `panel:${channelKey}`;

/** Well-known channels other modules look up by key. */
export const CHANNELS = {
  honeypot: "channel:honeypot",
  welcome: "channel:info:welcome",
  rules: "channel:info:rules",
  newMember: "channel:info:new-member",
  announcement: "channel:info:announcement",
  verify: "channel:info:verify",
  chat: "channel:chat:general",
  questions: "channel:chat:questions",
  ticket: "channel:chat:ticket",
  staffWork: "channel:staff:work",
} as const;

export const gameChannel = (game: GameKey, name: "general" | "voice" | "announcement" | "ticket") =>
  `channel:${game}:${name}`;
export const teamChannel = (game: GameKey, institution: Institution) =>
  `channel:${game}:team:${institution}`;

/** `มจพ. กรุงเทพฯ` → `มจพ-กรุงเทพฯ`: Discord text channel names take no spaces. */
export const channelSlug = (text: string) =>
  text.replace(/\./g, "").trim().replace(/\s+/g, "-").toLowerCase();

const COLORS = { staff: 0xf59e0b, rov: 0xef4444, tft: 0x8b5cf6, mlbb: 0x3b82f6 } as const;

export function buildLayout(): Layout {
  const roles: RoleSpec[] = [
    { key: "staff", name: "🛠️ Staff", color: COLORS.staff, hoist: true },
    ...GAMES.map((game): RoleSpec => ({
      key: `game:${game.key}`,
      name: `${game.emoji} ${game.name}`,
      color: COLORS[game.key],
      hoist: false,
    })),
    ...GAMES.flatMap((game) =>
      INSTITUTIONS.map((institution): RoleSpec => ({
        key: `team:${game.key}:${institution.id}`,
        name: `${game.name} · ${institution.short}`,
        color: COLORS[game.key],
        hoist: false,
      })),
    ),
  ];

  const readOnly = { everyone: "read", staff: "write" } as const;
  const ticketRoom = { everyone: "ticket", staff: "manage" } as const;

  const channels: ChannelSpec[] = [
    {
      key: CHANNELS.honeypot,
      kind: "text",
      name: "🍯・honeypot",
      topic: "⚠️ ห้ามพิมพ์ในช่องนี้ ใครพิมพ์จะถูกแบนอัตโนมัติ",
      access: { everyone: "write", staff: "write" },
      panel: "honeypot",
    },

    {
      key: "category:info",
      kind: "category",
      name: "「📌」ประกาศ & กฎ",
      access: readOnly,
    },
    {
      key: CHANNELS.welcome,
      kind: "text",
      name: "👋・welcome",
      parent: "category:info",
      topic: "ยินดีต้อนรับสู่ดิสคอร์ดงานแข่ง IT3K",
      access: readOnly,
      panel: "welcome",
    },
    {
      key: CHANNELS.rules,
      kind: "text",
      name: "📜・rules",
      parent: "category:info",
      topic: "กฎและนโยบายของเซิร์ฟเวอร์",
      access: readOnly,
    },
    {
      key: CHANNELS.newMember,
      kind: "text",
      name: "🚪・new-member",
      parent: "category:info",
      access: readOnly,
    },
    {
      key: CHANNELS.announcement,
      kind: "text",
      name: "📢・announcement",
      parent: "category:info",
      access: readOnly,
    },
    {
      key: CHANNELS.verify,
      kind: "text",
      name: "✅・verify",
      parent: "category:info",
      topic: "กดปุ่มเพื่อรับยศตามรายการแข่งของคุณ",
      access: readOnly,
      panel: "verify",
    },

    {
      key: "category:chat",
      kind: "category",
      name: "「💬」พูดคุย",
      access: { everyone: "write" },
    },
    {
      key: CHANNELS.chat,
      kind: "text",
      name: "💬・พูดคุย",
      parent: "category:chat",
      access: { everyone: "write" },
    },
    {
      key: CHANNELS.questions,
      kind: "forum",
      name: "❓・ถามตอบ",
      parent: "category:chat",
      topic: "ตั้งกระทู้ถามคำถามทั่วไปเกี่ยวกับงานแข่ง",
      access: { everyone: "write", staff: "manage" },
    },
    {
      key: CHANNELS.ticket,
      kind: "text",
      name: "🎫・ticket",
      parent: "category:chat",
      topic: "แจ้งปัญหาทั่วไปถึงทีมงาน",
      access: ticketRoom,
      panel: "ticket:general",
    },

    ...GAMES.flatMap((game): ChannelSpec[] => {
      const category = `category:${game.key}`;
      return [
        {
          key: category,
          kind: "category",
          name: `「${game.emoji}」${game.name}`,
          access: { everyone: "write" },
        },
        {
          key: gameChannel(game.key, "general"),
          kind: "text",
          name: "💬・พูดคุย",
          parent: category,
          access: { everyone: "write" },
        },
        {
          key: gameChannel(game.key, "voice"),
          kind: "voice",
          name: "🔊・voice-รวม",
          parent: category,
          access: { everyone: "write" },
        },
        {
          key: gameChannel(game.key, "announcement"),
          kind: "text",
          name: "📢・announcement",
          parent: category,
          access: readOnly,
        },
        {
          key: gameChannel(game.key, "ticket"),
          kind: "text",
          name: "🎫・ticket-แข่ง",
          parent: category,
          topic: `แจ้งปัญหาการแข่ง ${game.name} ถึงทีมงาน`,
          access: ticketRoom,
          panel: `ticket:${game.key}`,
        },
        ...INSTITUTIONS.map((institution): ChannelSpec => ({
          key: teamChannel(game.key, institution.id),
          kind: "text",
          name: `👥・ทีม-${channelSlug(institution.short)}`,
          parent: category,
          topic: `ห้องทีม ${game.name} ของ ${institution.name}`,
          access: {
            everyone: "hidden",
            [`team:${game.key}:${institution.id}`]: "write",
            staff: "write",
          },
        })),
      ];
    }),

    {
      key: "category:staff",
      kind: "category",
      name: "「🛠️」STAFF",
      access: { everyone: "hidden", staff: "write" },
    },
    {
      key: "channel:staff:announcement",
      kind: "text",
      name: "📢・staff-announcement",
      parent: "category:staff",
      access: { everyone: "hidden", staff: "read" },
    },
    {
      key: "channel:staff:rules",
      kind: "text",
      name: "📕・staff-rule",
      parent: "category:staff",
      access: { everyone: "hidden", staff: "read" },
    },
    {
      key: CHANNELS.staffWork,
      kind: "text",
      name: "💼・คุยงาน",
      parent: "category:staff",
      topic: "คุยงานทีมงาน · log ของบอท (honeypot) ส่งมาที่นี่",
      access: { everyone: "hidden", staff: "write" },
    },
  ];

  return { roles, channels };
}

/** The channel a ticket button of `scope` lives in. */
export const ticketChannel = (scope: TicketScope) =>
  scope === "general" ? CHANNELS.ticket : gameChannel(scope, "ticket");

export const isTicketScope = (value: string): value is TicketScope =>
  value === "general" || GAMES.some((game) => game.key === value);
