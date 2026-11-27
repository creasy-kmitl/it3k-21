import { type CommandInteraction, MessageFlags } from "discord.js";
import { Discord, Slash } from "discordx";

import { ping } from "../../lib/api";
import { currentMode, endpointFor } from "../../lib/context";
import { MODE_LABEL } from "../../lib/mode";
import { respond } from "../../lib/replies";

@Discord()
export class PingCommand {
  @Slash({ name: "ping", description: "เช็กว่าบอทและ API ยังทำงานอยู่" })
  async ping(interaction: CommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const mode = currentMode();
    const endpoint = endpointFor(mode);
    const result = await ping(endpoint);
    const gateway = `${Math.round(interaction.client.ws.ping)} ms`;
    if (!result.ok) {
      await respond(interaction, "error", {
        title: `API ${MODE_LABEL[mode]} ใช้ไม่ได้`,
        description: result.reason,
        fields: [
          { name: "API", value: endpoint.url },
          { name: "Gateway", value: gateway, inline: true },
        ],
      });
      return;
    }
    await respond(interaction, "success", {
      title: "pong 🏓",
      fields: [
        { name: "mode", value: `${MODE_LABEL[mode]} (stage \`${result.stage}\`)`, inline: true },
        { name: "API", value: `${result.ms} ms`, inline: true },
        { name: "Gateway", value: gateway, inline: true },
      ],
    });
  }
}
