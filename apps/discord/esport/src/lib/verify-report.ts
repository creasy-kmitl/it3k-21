// What a member sees after verify: their it3k details, the roles they now
// hold and their server nickname, as one notice. Discord-free so it can be
// tested; lib/sync.ts produces the outcome.
import type { MemberInfo } from "./api";
import { gameOf } from "./games";
import type { RoleKey } from "./layout";
import { institutionShort } from "./nickname";
import type { Notice, Tone } from "./replies";

export type LinkedMember = Extract<MemberInfo, { linked: true }>;

export type NicknameOutcome =
  | { status: "set"; value: string }
  | { status: "same"; value: string }
  | { status: "none" }
  | { status: "failed"; value: string; reason: string };

export type SyncOutcome = {
  info: LinkedMember;
  /** Managed roles the member holds now. */
  keep: RoleKey[];
  /** Role ids taken away because it3k no longer says so. */
  removed: string[];
  /** Why adding or removing roles failed, if it did. */
  roleError: string | null;
  nickname: NicknameOutcome;
};

const role = (id: string | undefined) => (id ? `<@&${id}>` : null);

function nicknameLine(outcome: NicknameOutcome) {
  switch (outcome.status) {
    case "set":
      return `\`${outcome.value}\``;
    case "same":
      return `\`${outcome.value}\` (ตั้งไว้แล้ว)`;
    case "none":
      return "ไม่เปลี่ยน: ยังไม่มีชื่อเล่น (ในโปรไฟล์) หรือชื่อในเกมบนเว็บ";
    case "failed":
      return `ตั้งเป็น \`${outcome.value}\` ไม่ได้: ${outcome.reason}`;
  }
}

function esportsLines(info: LinkedMember) {
  return info.esports.map((entry) => {
    const game = gameOf(entry);
    const team = institutionShort(entry.institution) ?? entry.institution;
    const ign = entry.ign.trim() ? ` · IGN \`${entry.ign.trim()}\`` : "";
    return game
      ? `${game.emoji} **${game.name}** · ทีม ${team}${ign}`
      : `• ${entry.divisionName} · ทีม ${team} (ดิสนี้ไม่มีห้องของรายการนี้)`;
  });
}

export function verifyReport(
  outcome: SyncOutcome,
  {
    userId,
    avatarUrl,
    roleId,
  }: {
    userId: string;
    avatarUrl?: string;
    roleId: (key: RoleKey) => string | undefined;
  },
): { tone: Tone; body: Notice } {
  const { info, keep, removed, roleError, nickname } = outcome;
  const roles = keep.map((key) => role(roleId(key))).filter(Boolean);
  const institution =
    institutionShort(info.esports.find((entry) => gameOf(entry))?.institution) ??
    institutionShort(info.institution);
  const games = esportsLines(info);

  const fields: NonNullable<Notice["fields"]> = [
    { name: "🪪 ชื่อในเซิร์ฟเวอร์", value: nicknameLine(nickname) },
    { name: "🏫 สถาบัน", value: institution ?? "—", inline: true },
  ];
  if (info.staff) {
    fields.push({ name: "🛠️ ทีมงาน", value: info.department ?? "ทีมงาน", inline: true });
  }
  if (games.length > 0) fields.push({ name: "🎮 รายการแข่ง", value: games.join("\n") });
  fields.push({
    name: "🏷️ ยศ",
    value:
      roles.length > 0
        ? roles.join(" ")
        : "ยังไม่มี: ยศจะมาเมื่อคุณเป็นทีมงาน หรือเป็นนักกีฬา Esports ที่ได้รับอนุมัติแล้ว",
  });
  if (removed.length > 0) {
    fields.push({ name: "➖ ถอดยศ", value: removed.map((id) => `<@&${id}>`).join(" ") });
  }
  if (roleError) fields.push({ name: "⚠️ ให้ยศไม่สำเร็จ", value: roleError });

  const problem = roleError !== null || nickname.status === "failed";
  const tone: Tone = problem ? "warning" : roles.length > 0 ? "success" : "info";
  const title = problem
    ? "ยืนยันตัวตนแล้ว แต่บางอย่างไม่สำเร็จ"
    : roles.length > 0
      ? "ยืนยันตัวตนเรียบร้อย"
      : "เชื่อมบัญชีแล้ว แต่ยังไม่มียศ";

  return {
    tone,
    body: {
      title,
      description: `ข้อมูลจากระบบ IT3K ของ <@${userId}>`,
      fields,
      thumbnail: avatarUrl,
      footer: "ข้อมูลบนเว็บเปลี่ยน? กดปุ่มรับยศอีกครั้งได้ทุกเมื่อ",
      timestamp: true,
    },
  };
}
