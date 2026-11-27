// Bot token rules shared by the API and the web app. Kept free of Drizzle so
// the browser bundle can import it.
import { z } from "zod";

/** Every token starts with this, so a leaked one is easy to recognise and search for. */
export const BOT_TOKEN_PREFIX = "it3kbot_";
/** How much of a token the list shows: the prefix and four more characters. */
export const BOT_TOKEN_SHOWN = BOT_TOKEN_PREFIX.length + 4;

export const botTokenInput = z.strictObject({
  name: z.string().trim().min(1, "กรุณาตั้งชื่อ").max(60, "ชื่อยาวได้ไม่เกิน 60 ตัวอักษร"),
});
export type BotTokenInput = z.infer<typeof botTokenInput>;
