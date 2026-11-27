import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { type ArgsOf, Discord, On } from "discordx";

import { store } from "../../lib/context";
import { CHANNELS, roleStoreKey } from "../../lib/layout";

/** A day of messages: what a spam bot posts across channels before anyone reacts. */
const PURGE_SECONDS = 24 * 60 * 60;

@Discord()
export class Honeypot {
  /**
   * Anyone who posts in the honeypot is softbanned: banned with a day of their
   * messages deleted, then unbanned, so a person who slipped can come back.
   * Staff and moderators are exempt. Needs no message content, only who
   * posted where.
   */
  @On({ event: "messageCreate" })
  async trap([message]: ArgsOf<"messageCreate">) {
    if (!message.inGuild() || message.author.bot || message.webhookId) return;
    if (message.channelId !== store().getId(CHANNELS.honeypot)) return;

    const member =
      message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    const staffRole = store().getId(roleStoreKey("staff"));
    if (
      (staffRole && member?.roles.cache.has(staffRole)) ||
      member?.permissions.has(PermissionFlagsBits.ManageMessages)
    ) {
      return;
    }

    const user = message.author;
    let outcome = "softban แล้ว (ลบข้อความ 24 ชม.)";
    try {
      await message.guild.members.ban(user.id, {
        deleteMessageSeconds: PURGE_SECONDS,
        reason: "honeypot: ส่งข้อความในห้องดักสแปม",
      });
      await message.guild.members.unban(user.id, "honeypot: softban");
    } catch (error) {
      outcome = `แบนไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`;
      await message.delete().catch(() => undefined);
    }

    const logId = store().getId(CHANNELS.staffWork);
    const log = logId ? await message.guild.channels.fetch(logId).catch(() => null) : null;
    if (!log?.isSendable()) return;
    await log.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("🍯 honeypot")
          .setDescription(`<@${user.id}> (${user.tag} · \`${user.id}\`) ส่งข้อความในห้องดักสแปม`)
          .addFields({ name: "ผล", value: outcome })
          .setTimestamp(),
      ],
      allowedMentions: { parse: [] },
    });
  }
}
