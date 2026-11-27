import { type ArgsOf, Discord, On } from "discordx";

import { store } from "../../lib/context";
import { CHANNELS } from "../../lib/layout";

@Discord()
export class Welcome {
  /** Greets each new member in the new-member channel and points them to verify. */
  @On({ event: "guildMemberAdd" })
  async greet([member]: ArgsOf<"guildMemberAdd">) {
    if (member.user.bot) return;
    const channelId = store().getId(CHANNELS.newMember);
    const channel = channelId
      ? await member.guild.channels.fetch(channelId).catch(() => null)
      : null;
    if (!channel?.isSendable()) return;
    const verify = store().getId(CHANNELS.verify);
    const rules = store().getId(CHANNELS.rules);
    await channel.send({
      content: [
        `👋 ยินดีต้อนรับ <@${member.id}> สู่ดิสคอร์ดงานแข่ง IT3K Esports!`,
        `${rules ? `อ่านกฎที่ <#${rules}> แล้ว` : ""}ไปรับยศรายการแข่งที่ ${verify ? `<#${verify}>` : "ช่อง verify"} ได้เลย`,
      ].join("\n"),
      allowedMentions: { users: [member.id] },
    });
  }
}
