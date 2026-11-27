import {
  ApplicationCommandOptionType,
  type CommandInteraction,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { Discord, Slash, SlashChoice, SlashOption } from "discordx";

import { ping } from "../../lib/api";
import { currentMode, endpointFor, store } from "../../lib/context";
import { MODES, MODE_LABEL, type Mode } from "../../lib/mode";
import { respond } from "../../lib/replies";

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
      await respond(interaction, result.ok ? "info" : "warning", {
        title: `mode ปัจจุบัน: ${MODE_LABEL[mode]}`,
        fields: [
          { name: "API", value: endpointFor(mode).url },
          {
            name: "สถานะ",
            value: result.ok ? `เชื่อมต่อได้ (${result.ms} ms)` : result.reason,
          },
        ],
      });
      return;
    }

    // Check the new endpoint first, so a typo'd token never strands the bot.
    const result = await ping(endpointFor(target));
    if (!result.ok) {
      await respond(interaction, "error", {
        title: `ยังไม่สลับ: ${MODE_LABEL[target]} ใช้ไม่ได้`,
        description: result.reason,
        fields: [
          { name: "API ที่ลอง", value: endpointFor(target).url },
          { name: "ยังใช้อยู่", value: MODE_LABEL[currentMode()] },
        ],
      });
      return;
    }
    store().setMode(target);
    await respond(interaction, "success", {
      title: `สลับเป็น ${MODE_LABEL[target]} แล้ว`,
      fields: [
        { name: "API", value: endpointFor(target).url },
        { name: "stage", value: `\`${result.stage}\``, inline: true },
        { name: "ตอบใน", value: `${result.ms} ms`, inline: true },
      ],
    });
  }
}
