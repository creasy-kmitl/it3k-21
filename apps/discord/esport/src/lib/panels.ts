// The messages the bot keeps posted in its channels: the honeypot warning,
// the welcome signpost, the verify button and the ticket buttons.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageCreateOptions,
} from "discord.js";

import { GAMES } from "./games";
import { CHANNELS, type Panel, gameChannel } from "./layout";

export const BRAND_COLOR = 0xf97316;

/** Resolves a layout key to a `<#id>` mention, or the plain name when it is missing. */
export type Mention = (channelKey: string, fallback: string) => string;

export type PanelMessage = Pick<MessageCreateOptions, "embeds" | "components">;

const button = (id: string, label: string, emoji: string, style: ButtonStyle) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style),
  );

export function buildPanel(panel: Panel, mention: Mention): PanelMessage {
  if (panel === "honeypot") {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0xef4444)
          .setTitle("🍯 ห้องดักสแปม · ห้ามพิมพ์")
          .setDescription(
            [
              "ช่องนี้มีไว้จับ **บอทสแปม** ที่ไล่ส่งข้อความทุกช่องเท่านั้น",
              "",
              "⛔ **ใครส่งข้อความในช่องนี้ จะถูกแบนออกจากเซิร์ฟเวอร์ทันที**",
              "🧹 ข้อความทั้งหมดของบัญชีนั้นย้อนหลัง 24 ชั่วโมงจะถูกลบ",
              "",
              `ถ้าเป็นคนจริงที่พิมพ์ผิดช่อง ยังกลับเข้ามาได้ด้วยลิงก์เชิญ (เป็น softban) แต่ขอให้ไปคุยที่ ${mention(CHANNELS.chat, "ช่องพูดคุย")} แทนนะ`,
            ].join("\n"),
          )
          .setFooter({ text: "ระบบอัตโนมัติ · IT3K Esports" }),
      ],
      components: [],
    };
  }

  if (panel === "welcome") {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(BRAND_COLOR)
          .setTitle("👋 ยินดีต้อนรับสู่ดิสคอร์ดงานแข่ง IT3K Esports")
          .setDescription("เริ่มจากอ่านกฎ แล้วไปกดรับยศ จากนั้นเลือกห้องของเกมที่คุณแข่งได้เลย")
          .addFields(
            {
              name: "📌 เริ่มต้น",
              value: [
                `📜 กฎและนโยบาย · ${mention(CHANNELS.rules, "rules")}`,
                `✅ รับยศรายการแข่ง · ${mention(CHANNELS.verify, "verify")}`,
                `📢 ประกาศ · ${mention(CHANNELS.announcement, "announcement")}`,
              ].join("\n"),
            },
            {
              name: "💬 พูดคุย",
              value: [
                `💬 คุยเล่น · ${mention(CHANNELS.chat, "พูดคุย")}`,
                `❓ ตั้งกระทู้ถาม · ${mention(CHANNELS.questions, "ถามตอบ")}`,
                `🎫 แจ้งปัญหาทั่วไป · ${mention(CHANNELS.ticket, "ticket")}`,
              ].join("\n"),
            },
            ...GAMES.map((game) => ({
              name: `${game.emoji} ${game.name}`,
              value: [
                mention(gameChannel(game.key, "general"), "พูดคุย"),
                mention(gameChannel(game.key, "announcement"), "announcement"),
                mention(gameChannel(game.key, "ticket"), "ticket-แข่ง"),
              ].join(" · "),
              inline: true,
            })),
          ),
      ],
      components: [],
    };
  }

  if (panel === "verify") {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor(0x22c55e)
          .setTitle("✅ รับยศรายการแข่ง")
          .setDescription(
            [
              "**1.** เข้าเว็บ IT3K → หน้า **โปรไฟล์ของฉัน** แล้วกด **เชื่อม Discord** ด้วยบัญชีนี้",
              "**2.** กลับมากดปุ่ม **รับยศ** ด้านล่าง",
              "",
              "บอทจะให้ยศตามข้อมูลในระบบ: ทีมงาน, นักกีฬา Esports ของเกมที่ได้รับอนุมัติ และห้องทีมของสถาบันคุณ",
              "ข้อมูลเปลี่ยน (เช่นเพิ่งได้รับอนุมัติ) กดปุ่มอีกครั้งเพื่ออัปเดตยศ",
            ].join("\n"),
          ),
      ],
      components: [button("verify", "รับยศ", "✅", ButtonStyle.Success)],
    };
  }

  const scope = panel.slice("ticket:".length);
  const game = GAMES.find((g) => g.key === scope);
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(BRAND_COLOR)
        .setTitle(game ? `🎫 แจ้งปัญหาการแข่ง ${game.name}` : "🎫 แจ้งปัญหาทั่วไป")
        .setDescription(
          [
            "กดปุ่มด้านล่างเพื่อเปิด ticket ห้องส่วนตัวที่เห็นแค่คุณกับทีมงาน",
            game
              ? "เช่น ปัญหาระหว่างแมตช์ ผลการแข่ง หรือรายชื่อผู้เล่น"
              : "เช่น ปัญหาการสมัคร บัญชี หรือคำถามที่ไม่อยากถามในห้องรวม",
            "ปิด ticket ได้เองเมื่อปัญหาได้รับการแก้แล้ว",
          ].join("\n"),
        ),
    ],
    components: [button(`ticket-open:${scope}`, "เปิด ticket", "🎫", ButtonStyle.Primary)],
  };
}
