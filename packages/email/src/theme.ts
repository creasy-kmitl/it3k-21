/**
 * The light tokens of `packages/ui/src/styles/globals.css`, as hex. Email
 * clients do not understand `oklch()`, and most ignore stylesheets, so every
 * template styles itself inline from these values.
 *
 *   --primary            oklch(0.505 0.213 27.518)  Tailwind red-700
 *   --primary-foreground oklch(0.971 0.013 17.38)   red-50
 *   --foreground         oklch(0.141 0.005 285.823) zinc-950
 *   --muted              oklch(0.967 0.001 286.375) zinc-100
 *   --muted-foreground   oklch(0.552 0.016 285.938) zinc-500
 *   --border             oklch(0.92 0.004 286.32)   zinc-200
 */
export const theme = {
  primary: "#c10007",
  primaryForeground: "#fef2f2",
  foreground: "#09090b",
  background: "#ffffff",
  muted: "#f4f4f5",
  mutedForeground: "#71717a",
  border: "#e4e4e7",
  /** --radius: 0.625rem */
  radius: "10px",
  /** The web app loads IBM Plex Sans Thai; Tahoma is the Thai fallback on Windows. */
  fontFamily: "'IBM Plex Sans Thai', 'Inter', Tahoma, 'Segoe UI', Helvetica, Arial, sans-serif",
} as const;

export const BRAND = "IT3Kings";
