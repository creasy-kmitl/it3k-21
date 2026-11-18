/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The main IT3Kings site, set per stage by packages/infra/alchemy.run.ts. */
  readonly VITE_WEB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
