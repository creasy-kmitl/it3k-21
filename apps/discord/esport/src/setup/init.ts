// /init builds the guild once. It lives outside src/modules/ so main.ts can
// leave it unimported once init_done is set: discordx then never registers it
// again. Run `bun run init:reset` and restart the bot to bring it back.
import {
  type CommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { Discord, Slash } from "discordx";

import { store } from "../lib/context";
import { respond } from "../lib/replies";
import { applyLayout } from "../lib/setup";

@Discord()
export class InitCommand {
  @Slash({
    name: "init",
    description: "ตั้งค่าเซิร์ฟเวอร์งานแข่ง: สร้างหมวด ช่อง และยศ (ใช้ได้ครั้งเดียว)",
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
    contexts: [InteractionContextType.Guild],
  })
  async init(interaction: CommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (store().initDone()) {
      await respond(interaction, "info", {
        title: "ตั้งค่าเซิร์ฟเวอร์ไปแล้ว",
        description: "ใช้ `bun run init:reset` แล้วรีสตาร์ทบอท ถ้าต้องการรันใหม่",
      });
      return;
    }

    const result = await applyLayout(interaction.guild, store());
    const summary = `สร้างใหม่ ${result.created.length} · ใช้ของเดิม ${result.reused.length}`;
    if (result.failed.length > 0) {
      // Keep /init so it can be run again once the cause (often the bot's role
      // being below others, or a missing permission) is fixed.
      await respond(interaction, "warning", {
        title: `ตั้งค่ายังไม่ครบ (พลาด ${result.failed.length})`,
        description: result.failed.map((line) => `• ${line}`).join("\n"),
        footer: `${summary} · แก้แล้วรัน /init อีกครั้งได้ ของที่สร้างแล้วจะไม่ถูกสร้างซ้ำ`,
      });
      return;
    }

    store().setInitDone(true);
    // Gone for everyone at once; main.ts keeps it from coming back on restart.
    await interaction.guild.commands.delete(interaction.commandId).catch(() => undefined);
    await respond(interaction, "success", {
      title: "ตั้งค่าเซิร์ฟเวอร์เรียบร้อย",
      description: "ลบคำสั่ง /init ออกแล้ว",
      footer: summary,
    });
  }
}
