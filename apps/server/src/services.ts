import { createAuth as createConfiguredAuth } from "@it3k/auth";
import { type Database, createDb } from "@it3k/db";

import { env } from "./env.server";

export function getDb(): Database {
  return createDb(env);
}
export async function createAuth(database?: Database) {
  return createConfiguredAuth(env, database ?? (await getDb()));
}
