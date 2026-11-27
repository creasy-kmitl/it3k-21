// `bun run init:reset`: forgets that /init ran, so the next start registers it
// again (e.g. to rebuild channels someone deleted). Reads SQLITE_PATH straight
// from the environment, so it runs without the bot's Discord secrets.
import { createBotStore } from "../lib/store";

// Same default as SQLITE_PATH in .env.schema; the Docker image sets /data/bot.sqlite.
const path = process.env.SQLITE_PATH || "./data/bot.sqlite";
const store = createBotStore(path, "dev");
store.setInitDone(false);
store.close();
console.log(`[esport-bot] init_done cleared in ${path}; restart the bot to get /init back.`);
