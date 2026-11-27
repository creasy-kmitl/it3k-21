// Wires the env into the pieces modules use. Built on first use, after
// main.ts has loaded the env through varlock.
import { ENV } from "../env";
import { type ApiClient, createApiClient } from "./api";
import type { Endpoint, Endpoints, Mode } from "./mode";
import { type BotStore, createBotStore } from "./store";

let opened: BotStore | undefined;

export function store(): BotStore {
  opened ??= createBotStore(ENV.SQLITE_PATH, ENV.DEFAULT_MODE);
  return opened;
}

export function endpoints(): Endpoints {
  return {
    dev: { url: ENV.API_URL_DEV, token: ENV.BOT_API_TOKEN_DEV },
    stg: { url: ENV.API_URL_STG, token: ENV.BOT_API_TOKEN_STG },
    prod: { url: ENV.API_URL_PROD, token: ENV.BOT_API_TOKEN_PROD },
  };
}

export const currentMode = (): Mode => store().getMode();

export const endpointFor = (mode: Mode): Endpoint => endpoints()[mode];

export const currentEndpoint = (): Endpoint => endpointFor(currentMode());

/** A client for the API of whichever mode is current right now. */
export const api = (): ApiClient => createApiClient(currentEndpoint());
