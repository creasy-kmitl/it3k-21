// Must stay the first import: loads and validates .env against .env.schema
// before anything reads ENV.
import "varlock/auto-load";

import { dirname, importx } from "@discordx/importer";
import { Events, IntentsBitField } from "discord.js";
import { Client } from "discordx";

import { ENV } from "./env";
import { MODE_LABEL } from "./lib/mode";
import { currentMode, store } from "./lib/context";
import { respondError } from "./lib/replies";

export const bot = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    // Privileged (turn on "Server Members Intent" in the Developer Portal):
    // the welcome module needs guildMemberAdd.
    IntentsBitField.Flags.GuildMembers,
    // Who posted where, for the honeypot. Message content is never needed.
    IntentsBitField.Flags.GuildMessages,
  ],
  // One guild: register there so commands appear at once.
  botGuilds: [ENV.DISCORD_GUILD_ID],
});

bot.once(Events.ClientReady, async () => {
  await bot.initApplicationCommands();
  if (store().initDone()) {
    // /init is not imported once it has run; drop any copy Discord still holds.
    const guild = await bot.guilds.fetch(ENV.DISCORD_GUILD_ID);
    const commands = await guild.commands.fetch();
    await Promise.all(commands.filter((c) => c.name === "init").map((c) => c.delete()));
  }
  console.log(`[esport-bot] ready as ${bot.user?.tag}, mode ${MODE_LABEL[currentMode()]}`);
});

bot.on(Events.InteractionCreate, async (interaction) => {
  try {
    await bot.executeInteraction(interaction);
  } catch (error) {
    console.error("[esport-bot] interaction failed", error);
    // Without an answer Discord shows "the application did not respond".
    if (interaction.isRepliable()) await respondError(interaction, error);
  }
});

// /init is offered only until it has set the guild up.
if (!store().initDone()) await import("./setup/init");
// Every module (src/modules/<name>/*.ts) registers its commands, buttons and
// events by being imported; adding a folder there is all a new one needs.
await importx(`${dirname(import.meta.url)}/modules/**/*.{ts,js}`);
await bot.login(ENV.DISCORD_BOT_TOKEN);
