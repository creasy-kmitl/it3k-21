// The server nickname the bot gives a member, from what it3k knows about
// them. Edit `nicknameFor` to change the format.
//
//   athlete   [มจธ.] <in-game name>     (their nickname when the IGN is empty)
//   staff     [Staff] <nickname>
//   others    [สจล.] <nickname>, or just <nickname> without an institution
//
// An athlete's team comes first: this is the esports server, and the staff
// role already shows on the member list. Nothing to go on (no nickname and no
// IGN) means the member's current name is left alone.
import { INSTITUTIONS } from "@it3k/db/profile";

import type { MemberInfo } from "./api";
import { gameOf } from "./games";

/** Discord's limit for a server nickname. */
export const NICKNAME_MAX = 32;

export const institutionShort = (id: string | null | undefined) =>
  INSTITUTIONS.find((institution) => institution.id === id)?.short ?? null;

const withTag = (tag: string | null, name: string) => {
  const prefix = tag ? `[${tag}] ` : "";
  const room = NICKNAME_MAX - prefix.length;
  const clipped = name.length > room ? `${name.slice(0, room - 1)}…` : name;
  return `${prefix}${clipped}`;
};

export function nicknameFor(member: MemberInfo): string | null {
  if (!member.linked || member.banned) return null;
  const nickname = member.nickname?.trim() || null;

  const athlete = member.esports.find((entry) => gameOf(entry));
  if (athlete) {
    const name = athlete.ign.trim() || nickname;
    return name ? withTag(institutionShort(athlete.institution), name) : null;
  }
  if (!nickname) return null;
  if (member.staff) return withTag("Staff", nickname);
  return withTag(institutionShort(member.institution), nickname);
}
