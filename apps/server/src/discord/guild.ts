// Adds a Discord user to the esports guild with their own OAuth token (the
// `guilds.join` scope). Discord only accepts this from a bot of the same
// application that issued the token, so the web's Discord OAuth app and the
// esports bot (apps/discord/esport) must be one application.
// https://discord.com/developers/docs/resources/guild#add-guild-member

/** The OAuth scope that lets the bot add the user to a guild. */
export const GUILDS_JOIN = "guilds.join";

/** `scope` as Better Auth stores it: Discord's scopes, joined by commas or spaces. */
export function grantsGuildsJoin(scope: string | null | undefined): boolean {
  return (scope ?? "").split(/[\s,]+/).includes(GUILDS_JOIN);
}

export type GuildConfig = { botToken: string; guildId: string };

/** "joined": added now. "member": was already in the guild. */
export type GuildJoin = "joined" | "member";

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    /** Discord's JSON error code, e.g. 50025 for an invalid OAuth2 access token. */
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "DiscordApiError";
  }

  /** The user's token is unusable here (expired, revoked or from another app): they must link again. */
  get needsConsent() {
    return this.code === 50025 || this.status === 401;
  }
}

/** Opens the guild in Discord (for someone already in it). */
export function guildUrl(guildId: string) {
  return `https://discord.com/channels/${guildId}`;
}

export async function addGuildMember(
  config: GuildConfig,
  member: { discordUserId: string; accessToken: string },
  fetcher: typeof fetch = fetch,
): Promise<GuildJoin> {
  const res = await fetcher(
    `https://discord.com/api/v10/guilds/${encodeURIComponent(config.guildId)}/members/${encodeURIComponent(member.discordUserId)}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bot ${config.botToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ access_token: member.accessToken }),
    },
  );
  if (res.status === 201) return "joined";
  if (res.status === 204) return "member";
  const body = (await res.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
  throw new DiscordApiError(
    res.status,
    typeof body?.code === "number" ? body.code : null,
    typeof body?.message === "string" ? body.message : `Discord answered ${res.status}`,
  );
}
