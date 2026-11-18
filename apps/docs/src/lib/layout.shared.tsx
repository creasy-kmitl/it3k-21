import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { appName, gitConfig, webUrl } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: appName,
    },
    links: [{ text: "ไปที่เว็บไซต์ IT3Kings", url: webUrl, external: true }],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
