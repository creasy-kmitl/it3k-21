import { type CommandInteraction, MessageFlags } from "discord.js";
import { Discord, Slash } from "discordx";

import { ping } from "../../lib/api";
import { currentMode, endpointFor } from "../../lib/context";
import { MODE_LABEL } from "../../lib/mode";

@Discord()
export class PingCommand {
  @Slash({ name: "ping", description: "เช็กว่าบอทและ API ยังทำงานอยู่" })
  async ping(interaction: CommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const mode = currentMode();
    const result = await ping(endpointFor(mode));
    const gateway = `gateway ${Math.round(interaction.client.ws.ping)} ms`;
    await interaction.editReply(
      result.ok
        ? `🏓 pong · ${MODE_LABEL[mode]} (stage \`${result.stage}\`) · API ${result.ms} ms · ${gateway}`
        : `⚠️ ${MODE_LABEL[mode]} ใช้ไม่ได้: ${result.reason} · ${gateway}`,
    );
  }
}
