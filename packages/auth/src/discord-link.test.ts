import { describe, expect, test } from "bun:test";

import { discordLinkFrom } from ".";

const row = {
  userId: "u1",
  providerId: "discord",
  accountId: "123",
  accessToken: "token",
  scope: "identify,email,guilds.join",
};

describe("discordLinkFrom", () => {
  test("the OAuth callback writing a Discord account is a link", () => {
    expect(discordLinkFrom(row, "/callback/:id")).toEqual({
      userId: "u1",
      discordUserId: "123",
      accessToken: "token",
      scope: "identify,email,guilds.join",
    });
  });

  test("a token refresh is not, so leaving the guild sticks", () => {
    expect(discordLinkFrom(row, "/get-access-token")).toBeNull();
    expect(discordLinkFrom(row, "/account-info")).toBeNull();
    expect(discordLinkFrom(row, undefined)).toBeNull();
  });

  test("other providers, and rows without a token, are not", () => {
    expect(discordLinkFrom({ ...row, providerId: "google" }, "/callback/:id")).toBeNull();
    expect(discordLinkFrom({ ...row, accessToken: null }, "/callback/:id")).toBeNull();
    expect(discordLinkFrom(null, "/callback/:id")).toBeNull();
  });
});
