// Must stay the first import: loads and validates .env against .env.schema
// before anything reads ENV.
import "varlock/auto-load";

import { dirname, importx } from "@discordx/importer";
import { Events, IntentsBitField } from "discord.js";
import { Client } from "discordx";

import { ENV } from "./env";
import { MODE_LABEL } from "./lib/mode";
import { currentMode } from "./lib/context";

export const bot = new Client({
  // Slash commands only, so the Guilds intent is all the gateway needs.
  intents: [IntentsBitField.Flags.Guilds],
  // One guild: register there so commands appear at once.
  botGuilds: [ENV.DISCORD_GUILD_ID],
});

bot.once(Events.ClientReady, async () => {
  await bot.initApplicationCommands();
  console.log(`[esport-bot] ready as ${bot.user?.tag}, mode ${MODE_LABEL[currentMode()]}`);
});

bot.on(Events.InteractionCreate, (interaction) => {
  void bot.executeInteraction(interaction);
});

// Every module (src/modules/<name>/*.ts) registers its commands by being
// imported; adding a folder there is all a new command needs.
await importx(`${dirname(import.meta.url)}/modules/**/*.{ts,js}`);
await bot.login(ENV.DISCORD_BOT_TOKEN);
