import { type ButtonInteraction, MessageFlags } from "discord.js";
import { type ArgsOf, ButtonComponent, Discord, On } from "discordx";

import { store } from "../../lib/context";
import { roleStoreKey } from "../../lib/layout";
import { reasonOf, respond } from "../../lib/replies";
import { syncMember } from "../../lib/sync";
import { verifyReport } from "../../lib/verify-report";

@Discord()
export class VerifyButton {
  /** The button on the verify panel: roles and nickname from what it3k says about this member. */
  @ButtonComponent({ id: "verify" })
  async verify(interaction: ButtonInteraction) {
    if (!interaction.inCachedGuild()) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let result: Awaited<ReturnType<typeof syncMember>>;
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      result = await syncMember(member, "verify");
    } catch (error) {
      await respond(interaction, "error", {
        title: "ตอนนี้ตรวจสอบข้อมูลไม่ได้",
        description: "ลองใหม่อีกครั้งภายหลัง ถ้ายังไม่ได้ให้แจ้งทีมงาน",
        fields: [{ name: "รายละเอียด", value: reasonOf(error) }],
      });
      return;
    }

    if (!result.linked) {
      await respond(interaction, "warning", {
        title: "ยังไม่พบบัญชี Discord นี้ในระบบ IT3K",
        description: [
          "1. เข้าสู่ระบบเว็บ IT3K แล้วไปที่หน้าโปรไฟล์",
          "2. กด **เชื่อม Discord** ในการ์ด Discord",
          "3. กลับมากดปุ่มรับยศอีกครั้ง",
        ].join("\n"),
        links: [{ label: "เปิดหน้าโปรไฟล์", url: result.linkUrl, emoji: "🔗" }],
      });
      return;
    }
    if (result.info.banned) {
      await respond(interaction, "error", {
        title: "รับยศไม่ได้",
        description: "บัญชีนี้ถูกระงับในระบบ IT3K ติดต่อทีมงานถ้าคิดว่าเป็นความผิดพลาด",
      });
      return;
    }

    const { tone, body } = verifyReport(result, {
      userId: interaction.user.id,
      avatarUrl: interaction.user.displayAvatarURL({ size: 128 }),
      roleId: (key) => store().getId(roleStoreKey(key)),
    });
    await respond(interaction, tone, body);
  }

  /**
   * Someone who linked Discord on the web before joining gets their roles and
   * nickname at once, with no button to press. Quiet on purpose: the welcome
   * module greets them, and the verify button still reports in full.
   */
  @On({ event: "guildMemberAdd" })
  async autoSync([member]: ArgsOf<"guildMemberAdd">) {
    if (member.user.bot) return;
    try {
      await syncMember(member, "เข้าเซิร์ฟเวอร์: ซิงก์กับระบบ IT3K");
    } catch (error) {
      console.warn(`[esport-bot] auto sync of ${member.id} failed: ${reasonOf(error)}`);
    }
  }
}
