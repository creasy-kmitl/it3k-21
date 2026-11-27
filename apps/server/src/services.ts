import { createAuth as createConfiguredAuth, type DiscordLink } from "@it3k/auth";
import { type Database, createDb } from "@it3k/db";

import { type GuildConfig, addGuildMember, grantsGuildsJoin } from "./discord/guild";
import { env } from "./env.server";
import { esportsDiscordAudience, inEsportsDiscord } from "./policies/esports-discord";

export function getDb(): Database {
  return createDb(env);
}

/** The esports guild, when both its bot token and id are set on this stage. */
export function guildConfig(): GuildConfig | null {
  const botToken = env.DISCORD_BOT_TOKEN ?? "";
  const guildId = env.DISCORD_GUILD_ID ?? "";
  return botToken && guildId ? { botToken, guildId } : null;
}

/**
 * Linking Discord adds the account to the esports guild right away, if it is
 * one the guild is for (its staff and esports entrants). The bot then gives
 * roles and a nickname when it sees them join (guildMemberAdd).
 */
async function joinGuildOnLink(database: Database, link: DiscordLink) {
  const guild = guildConfig();
  if (!guild || !grantsGuildsJoin(link.scope)) return;
  if (!inEsportsDiscord(await esportsDiscordAudience(database, link.userId))) return;
  await addGuildMember(guild, link);
}

export async function createAuth(database?: Database) {
  const db = database ?? (await getDb());
  return createConfiguredAuth(env, db, [], {
    onDiscordLinked: (link) => joinGuildOnLink(db, link),
  });
}
