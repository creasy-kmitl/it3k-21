// Varlock validates VITE_SERVER_URL as required at build time (.env.schema).
// Declared here because bun-types (pulled in through unplugin's types) widens
// every `import.meta.env` key to `string | undefined`.
interface ImportMetaEnv {
  readonly VITE_SERVER_URL: string;
}
