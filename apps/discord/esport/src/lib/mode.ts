/** Which apps/server stage the bot talks to; switched with /mode. */
export const MODES = ["dev", "stg", "prod"] as const;
export type Mode = (typeof MODES)[number];

export const MODE_LABEL: Record<Mode, string> = {
  dev: "dev (เครื่อง local)",
  stg: "staging",
  prod: "production",
};

export const isMode = (value: unknown): value is Mode => MODES.includes(value as Mode);

/** One stage's API: its origin and the BOT_API_TOKEN it accepts. */
export type Endpoint = { url: string; token: string | undefined };
export type Endpoints = Record<Mode, Endpoint>;
