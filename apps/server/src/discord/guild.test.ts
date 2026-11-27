import { describe, expect, test } from "bun:test";

import { DiscordApiError, addGuildMember, grantsGuildsJoin } from "./guild";

const guild = { botToken: "bot-token", guildId: "42" };
const member = { discordUserId: "7", accessToken: "user-token" };

function fakeFetch(status: number, body?: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

describe("grantsGuildsJoin", () => {
  test("reads scopes joined by commas or spaces", () => {
    expect(grantsGuildsJoin("identify,email,guilds.join")).toBe(true);
    expect(grantsGuildsJoin("identify guilds.join")).toBe(true);
    expect(grantsGuildsJoin("identify,email")).toBe(false);
    expect(grantsGuildsJoin("guilds")).toBe(false);
    expect(grantsGuildsJoin(null)).toBe(false);
  });
});

describe("addGuildMember", () => {
  test("PUTs the user's token with the bot's authorization", async () => {
    const { calls, fetcher } = fakeFetch(201, {});
    expect(await addGuildMember(guild, member, fetcher)).toBe("joined");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://discord.com/api/v10/guilds/42/members/7");
    expect(calls[0]?.init.method).toBe("PUT");
    const headers = calls[0]?.init.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe("Bot bot-token");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ access_token: "user-token" });
  });

  test("204 means the user was already in the guild", async () => {
    expect(await addGuildMember(guild, member, fakeFetch(204).fetcher)).toBe("member");
  });

  test("an invalid OAuth token asks for consent; other errors do not", async () => {
    const invalid = await addGuildMember(
      guild,
      member,
      fakeFetch(403, { code: 50025, message: "Invalid OAuth2 access token" }).fetcher,
    ).catch((error: unknown) => error);
    expect(invalid).toBeInstanceOf(DiscordApiError);
    expect((invalid as DiscordApiError).needsConsent).toBe(true);

    const missing = await addGuildMember(
      guild,
      member,
      fakeFetch(403, { code: 50013, message: "Missing Permissions" }).fetcher,
    ).catch((error: unknown) => error);
    expect((missing as DiscordApiError).needsConsent).toBe(false);
    expect((missing as DiscordApiError).message).toBe("Missing Permissions");
  });
});
