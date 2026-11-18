import { z } from "zod";

/**
 * A local dev API serves uploads from http://localhost, so pictures picked
 * from the file library there are allowed too; everything else must be https.
 */
const LOCAL_HTTP = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;

export const isImageUrl = (value: string) =>
  value.startsWith("https://") || LOCAL_HTTP.test(value);

/** An optional picture link: blank for none. */
export const imageUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => value === "" || isImageUrl(value), "ใช้ลิงก์ที่ขึ้นต้นด้วย https://");
