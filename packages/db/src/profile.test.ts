import { expect, test } from "bun:test";
import { draftSchema, EMPTY_PROFILE, profileSchema } from "./profile";

const values = {
  ...EMPTY_PROFILE,
  prefix: "นาย",
  firstName: "สมชาย",
  lastName: "ใจดี",
  nickname: "ชาย",
  institution: "kmitl",
  photoFileId: crypto.randomUUID(),
};

for (const [input, normalized] of [
  ["081-234-5678", "0812345678"],
  ["+66 81 234 5678", "+66812345678"],
  [" 081 234 5678 ", "0812345678"],
] as const) {
  test(`submitted phone ${input} is normalized and satisfies the draft schema`, () => {
    const parsed = profileSchema.parse({ ...values, phone: input });
    expect(parsed.phone).toBe(normalized);
    expect(draftSchema.safeParse(parsed).success).toBe(true);
  });
}

for (const phone of ["081234567", "081x2345678", `081${" ".repeat(23)}2345678`]) {
  test(`rejects invalid phone input of length ${phone.length}`, () => {
    expect(profileSchema.safeParse({ ...values, phone }).success).toBe(false);
  });
}
