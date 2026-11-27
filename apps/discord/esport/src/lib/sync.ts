// Brings one guild member in line with it3k: the managed roles and the server
// nickname. Used by the verify button and when a member joins.
import type { GuildMember } from "discord.js";

import { fetchMember } from "./api";
import { currentEndpoint, store } from "./context";
import { roleStoreKey } from "./layout";
import { planRoleChange, rolesFor } from "./member-roles";
import { nicknameFor } from "./nickname";
import { reasonOf } from "./replies";
import type { LinkedMember, NicknameOutcome, SyncOutcome } from "./verify-report";

export type SyncResult = { linked: false; linkUrl: string } | ({ linked: true } & SyncOutcome);

/** Throws when the API cannot be reached; everything after that is reported, not thrown. */
export async function syncMember(member: GuildMember, reason: string): Promise<SyncResult> {
  const info = await fetchMember(currentEndpoint(), member.id);
  if (!info.linked) return { linked: false, linkUrl: info.linkUrl };

  const change = planRoleChange(rolesFor(info), new Set(member.roles.cache.keys()), (key) =>
    store().getId(roleStoreKey(key)),
  );
  let roleError: string | null = null;
  try {
    if (change.add.length > 0) await member.roles.add(change.add, reason);
    if (change.remove.length > 0) await member.roles.remove(change.remove, reason);
  } catch (error) {
    roleError = `บอทอาจไม่มีสิทธิ์ Manage Roles หรือยศของบอทอยู่ต่ำกว่ายศที่ต้องให้ (${reasonOf(error)})`;
  }

  return {
    linked: true,
    info: info as LinkedMember,
    keep: roleError ? [] : change.keep,
    removed: roleError ? [] : change.remove,
    roleError,
    nickname: await applyNickname(member, nicknameFor(info), reason),
  };
}

async function applyNickname(
  member: GuildMember,
  wanted: string | null,
  reason: string,
): Promise<NicknameOutcome> {
  if (!wanted) return { status: "none" };
  if (member.nickname === wanted) return { status: "same", value: wanted };
  // Discord lets no bot rename the server owner or anyone ranked above it.
  if (member.id === member.guild.ownerId) {
    return { status: "failed", value: wanted, reason: "Discord ไม่ให้บอทเปลี่ยนชื่อเจ้าของเซิร์ฟเวอร์" };
  }
  if (!member.manageable) {
    return { status: "failed", value: wanted, reason: "ยศของคุณอยู่สูงกว่ายศของบอท" };
  }
  try {
    await member.setNickname(wanted, reason);
    return { status: "set", value: wanted };
  } catch (error) {
    return { status: "failed", value: wanted, reason: reasonOf(error) };
  }
}
