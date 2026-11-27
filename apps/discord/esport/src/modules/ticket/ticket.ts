import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
} from "discord.js";
import { ButtonComponent, Discord } from "discordx";

import { store } from "../../lib/context";
import { isTicketScope, roleStoreKey } from "../../lib/layout";
import { notice, respond } from "../../lib/replies";

/** Discord caps thread names at 100 characters. */
const ticketName = (username: string) => `ticket-${username}`.slice(0, 100);

@Discord()
export class TicketButtons {
  /** Opens a private thread only the member and staff can see. */
  @ButtonComponent({ id: /^ticket-open:/ })
  async open(interaction: ButtonInteraction) {
    if (!interaction.inCachedGuild()) return;
    const scope = interaction.customId.slice("ticket-open:".length);
    const channel = interaction.channel;
    if (!isTicketScope(scope) || channel?.type !== ChannelType.GuildText) {
      await respond(interaction, "error", {
        title: "ปุ่มนี้ใช้ไม่ได้แล้ว",
        description: "แจ้งทีมงานให้ส่งปุ่ม ticket ใหม่",
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const name = ticketName(interaction.user.username);
    const active = await channel.threads.fetchActive();
    const open = active.threads.find(
      (thread) => thread.name === name && thread.parentId === channel.id,
    );
    if (open) {
      await respond(interaction, "warning", {
        title: "คุณมี ticket ที่ยังเปิดอยู่",
        description: `คุยต่อได้ที่ <#${open.id}>`,
      });
      return;
    }

    const thread = await channel.threads.create({
      name,
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: `ticket ของ ${interaction.user.tag}`,
    });
    await thread.members.add(interaction.user.id);

    const staffRole = store().getId(roleStoreKey("staff"));
    await thread.send({
      content: [
        `${staffRole ? `<@&${staffRole}> ` : ""}<@${interaction.user.id}> เปิด ticket ใหม่`,
        "เล่าปัญหาได้เลย ทีมงานจะเข้ามาตอบในห้องนี้ (เห็นแค่คุณกับทีมงาน)",
      ].join("\n"),
      // Mentioning the staff role adds staff to the private thread.
      allowedMentions: { users: [interaction.user.id], roles: staffRole ? [staffRole] : [] },
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`ticket-close:${interaction.user.id}`)
            .setLabel("ปิด ticket")
            .setEmoji("🔒")
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
    await respond(interaction, "success", {
      title: "เปิด ticket แล้ว",
      description: `ไปที่ <#${thread.id}>`,
    });
  }

  /** Locks and archives the ticket; the member who opened it or staff may. */
  @ButtonComponent({ id: /^ticket-close:/ })
  async close(interaction: ButtonInteraction) {
    if (!interaction.inCachedGuild()) return;
    const thread = interaction.channel;
    if (!thread?.isThread()) return;
    const openerId = interaction.customId.slice("ticket-close:".length);
    const staffRole = store().getId(roleStoreKey("staff"));
    const isStaff =
      (staffRole !== undefined && interaction.member.roles.cache.has(staffRole)) ||
      interaction.member.permissions.has(PermissionFlagsBits.ManageThreads);
    if (interaction.user.id !== openerId && !isStaff) {
      await respond(interaction, "error", {
        title: "ปิด ticket ไม่ได้",
        description: "ปิดได้เฉพาะคนที่เปิด ticket หรือทีมงาน",
      });
      return;
    }
    await interaction.reply({
      embeds: [
        notice("info", {
          title: "🔒 ปิด ticket แล้ว",
          description: `ปิดโดย <@${interaction.user.id}>`,
        }),
      ],
      allowedMentions: { parse: [] },
    });
    await thread.setLocked(true);
    await thread.setArchived(true);
  }
}
