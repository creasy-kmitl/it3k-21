// How the bot answers commands and buttons: one embed, coloured by what
// happened, so errors and warnings stand out from a plain success. Pure
// builders here; `respond` and `respondError` do the Discord call.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type CommandInteraction,
  EmbedBuilder,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type MessageComponentInteraction,
  MessageFlags,
  type ModalSubmitInteraction,
} from "discord.js";

import { BRAND_COLOR } from "./panels";

/** Anything the bot answers: slash commands, buttons and other components, modals. */
export type Answerable = CommandInteraction | MessageComponentInteraction | ModalSubmitInteraction;

export type Tone = "error" | "warning" | "success" | "info";

const TONES: Record<Tone, { color: number; icon: string }> = {
  error: { color: 0xef4444, icon: "❌" },
  warning: { color: 0xf59e0b, icon: "⚠️" },
  success: { color: 0x22c55e, icon: "✅" },
  info: { color: BRAND_COLOR, icon: "ℹ️" },
};

/** Discord caps an embed description at 4096 characters and a field value at 1024. */
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

export type Notice = {
  title: string;
  description?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  /** Small grey text at the bottom, e.g. which API mode answered. */
  footer?: string;
  /** A small image top right, e.g. the member's avatar. */
  thumbnail?: string;
  /** Show when this happened, next to the footer. */
  timestamp?: boolean;
  /** Link buttons under the embed, e.g. to the web page that fixes the problem. */
  links?: { label: string; url: string; emoji?: string }[];
};

export function notice(
  tone: Tone,
  { title, description, fields, footer, thumbnail, timestamp }: Notice,
) {
  const { color, icon } = TONES[tone];
  const embed = new EmbedBuilder().setColor(color).setTitle(`${icon} ${title}`);
  if (description) embed.setDescription(clip(description, 4096));
  if (fields?.length) embed.addFields(fields.map((f) => ({ ...f, value: clip(f.value, 1024) })));
  if (footer) embed.setFooter({ text: footer });
  if (thumbnail) embed.setThumbnail(thumbnail);
  if (timestamp) embed.setTimestamp();
  return embed;
}

/** One row of link buttons, or none. */
export function linkRows(links: Notice["links"]) {
  if (!links?.length) return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      links.slice(0, 5).map((link) => {
        const button = new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setURL(link.url)
          .setLabel(link.label);
        return link.emoji ? button.setEmoji(link.emoji) : button;
      }),
    ),
  ];
}

/** The text of anything thrown, for the error embed. */
export const reasonOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Answers an interaction with one notice, whether or not it was deferred.
 * New replies are ephemeral unless `visible` is set.
 */
export async function respond(
  interaction: Answerable,
  tone: Tone,
  body: Notice,
  { visible = false }: { visible?: boolean } = {},
) {
  const embeds = [notice(tone, body)];
  const components = linkRows(body.links);
  if (interaction.deferred || interaction.replied) {
    // `content: ""` clears any text an earlier editReply left.
    const edit: InteractionEditReplyOptions = { content: "", embeds, components };
    await (interaction.deferred && !interaction.replied
      ? interaction.editReply(edit)
      : interaction.followUp({ embeds, components, flags: MessageFlags.Ephemeral }));
    return;
  }
  const reply: InteractionReplyOptions = visible
    ? { embeds, components }
    : { embeds, components, flags: MessageFlags.Ephemeral };
  await interaction.reply(reply);
}

/**
 * What a member sees when a command or button throws: an error embed instead
 * of Discord's "the application did not respond". Never throws itself.
 */
export async function respondError(interaction: Answerable, error: unknown) {
  await respond(interaction, "error", {
    title: "เกิดข้อผิดพลาด",
    description: "บอททำรายการนี้ไม่สำเร็จ ลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งทีมงาน",
    fields: [{ name: "รายละเอียด", value: `\`\`\`${reasonOf(error).slice(0, 900)}\`\`\`` }],
  }).catch(() => undefined);
}
