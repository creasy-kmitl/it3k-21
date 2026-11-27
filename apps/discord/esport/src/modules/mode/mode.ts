import {
  ApplicationCommandOptionType,
  type CommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashOption } from "discordx";

import { ping } from "../../lib/api";
import { currentMode, endpointFor, modeStore } from "../../lib/context";
import { MODES, MODE_LABEL, type Mode } from "../../lib/mode";

@Discord()
export class ModeCommand {
  @Slash({
    name: "mode",
    description: "ดูหรือสลับ API ที่บอทใช้ (dev / stg / prod)",
    // Discord hides the command from everyone else; admins can widen it per
    // role in Server Settings → Integrations.
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
    contexts: [InteractionContextType.Guild],
  })
  async mode(
    @SlashChoice(...MODES.map((mode) => ({ name: MODE_LABEL[mode], value: mode })))
    @SlashOption({
      name: "env",
      description: "mode ที่จะสลับไป เว้นว่างเพื่อดู mode ปัจจุบัน",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    target: Mode | undefined,
    interaction: CommandInteraction,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!target) {
      const mode = currentMode();
      const result = await ping(endpointFor(mode));
      await interaction.editReply(
        [
          `mode ปัจจุบัน: **${MODE_LABEL[mode]}**`,
          `API: ${endpointFor(mode).url}`,
          result.ok ? `สถานะ: เชื่อมต่อได้ (${result.ms} ms)` : `สถานะ: ⚠️ ${result.reason}`,
        ].join("\n"),
      );
      return;
    }

    // Check the new endpoint first, so a typo'd token never strands the bot.
    const result = await ping(endpointFor(target));
    if (!result.ok) {
      await interaction.editReply(
        `ยังไม่สลับ: ${MODE_LABEL[target]} ใช้ไม่ได้ (${result.reason})\nยังใช้ **${MODE_LABEL[currentMode()]}** อยู่`,
      );
      return;
    }
    modeStore().set(target);
    await interaction.editReply(
      `สลับเป็น **${MODE_LABEL[target]}** แล้ว\nAPI: ${endpointFor(target).url} (stage \`${result.stage}\`, ${result.ms} ms)`,
    );
  }
}
