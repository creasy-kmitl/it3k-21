import { describe, expect, test } from "bun:test";

import { type EmailActor, canSendEmail } from "./email";

const actor = (overrides: Partial<EmailActor> = {}): EmailActor => ({
  role: "staff",
  leadershipRole: null,
  departmentCode: null,
  institution: null,
  banned: false,
  ...overrides,
});

describe("canSendEmail", () => {
  test("admins, every Tech/Live member and KMITL registration leaders send", () => {
    for (const who of [
      actor({ role: "admin" }),
      actor({ departmentCode: "tech-live" }),
      actor({ departmentCode: "tech-live", institution: "kmutt" }),
      actor({ departmentCode: "registration", leadershipRole: "head", institution: "kmitl" }),
      // A seat counts as KMITL's when the account has no institution.
      actor({ departmentCode: "registration", leadershipRole: "vicehead" }),
    ]) {
      expect(canSendEmail(who)).toBe(true);
    }
  });

  test("registration staff, other institutions' seats and other departments do not", () => {
    for (const who of [
      null,
      actor({ departmentCode: "registration", institution: "kmitl" }),
      actor({ departmentCode: "registration", leadershipRole: "head", institution: "kmutt" }),
      actor({ departmentCode: null, leadershipRole: "head", institution: "kmitl" }),
      actor({ role: "participant", departmentCode: "tech-live" }),
      actor({ role: "admin", banned: true }),
    ]) {
      expect(canSendEmail(who)).toBe(false);
    }
  });
});
