export const appName = "IT3Kings · คู่มือ";
export const docsRoute = "/docs";

/** The main site, so readers can get back to it from any page. */
export const webUrl = import.meta.env.VITE_WEB_URL ?? "http://localhost:3001";

export const gitConfig = {
  user: "creasy-kmitl",
  repo: "it3k-21",
  branch: "main",
  /** Where the MDX files live inside the repository. */
  contentDir: "apps/docs/content/docs",
};
