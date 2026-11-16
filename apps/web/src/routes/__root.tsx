import { Toaster } from "@it3k/ui/components/sonner";
import { PRELOAD_FONTS } from "@it3k/ui/lib/fonts";
import type { QueryClient } from "@tanstack/react-query";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { ConnectionStatus } from "../components/connection-status";
import { NavigationProgress } from "../components/navigation-progress";
import NotFound from "../components/not-found";
import { ViewModeBanner } from "../components/view-mode-banner";
import { getOrigin } from "../functions/get-origin";
import { type PageOg, loadPageOg } from "../lib/og";

import appCss from "../index.css?url";

export interface RouterAppContext {
  queryClient: QueryClient;
}

const SITE_TITLE = "IT3Kings";
const SITE_DESCRIPTION =
  "มหกรรมแข่งขันกีฬาสานสัมพันธ์ของนักศึกษาด้านเทคโนโลยีสารสนเทศจาก 3 สถาบันพระจอมเกล้า (มจธ., มจพ. และ สจล.)";

/**
 * Preloads for the fonts the first paint needs. Client-only pages (`ssr:
 * false`, e.g. /staff and /login) paint nothing until their JavaScript runs,
 * so a preload there sits unused and browsers warn about it; they skip it.
 */
export function fontPreloads(matches: readonly { ssr?: boolean | "data-only" }[]) {
  if (matches.some((match) => match.ssr === false)) return [];
  return PRELOAD_FONTS.map((href) => ({
    rel: "preload",
    href,
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous" as const,
  }));
}

/**
 * The page's title, description and link preview (Open Graph, X cards).
 * `og` is the shared page's own preview (lib/og.ts); without it, the site's.
 */
export function siteMeta({
  origin,
  path,
  og,
}: {
  origin: string;
  path: string;
  og: PageOg | null;
}) {
  const title = og ? `${og.title} · ${SITE_TITLE}` : SITE_TITLE;
  const description = og?.description ?? SITE_DESCRIPTION;
  // The site picture is drawn to the preview size; an event's cover is whatever was uploaded.
  const image = og?.image ?? `${origin}/og.png`;
  const imageSize = og?.image
    ? []
    : [
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
      ];
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_TITLE },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: og ? `${origin}${path}` : origin },
    { property: "og:image", content: image },
    ...imageSize,
    { property: "og:image:alt", content: og ? og.title : `${SITE_TITLE} — ${SITE_DESCRIPTION}` },
    { property: "og:locale", content: "th_TH" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ];
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  loader: async ({ location }) => ({
    origin: getOrigin(),
    path: location.pathname,
    og: await loadPageOg(location.pathname),
  }),
  head: ({ loaderData, matches }) => {
    return {
      meta: [
        {
          charSet: "utf-8",
        },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1",
        },
        ...siteMeta({
          origin: loaderData?.origin ?? "",
          path: loaderData?.path ?? "/",
          og: loaderData?.og ?? null,
        }),
        { name: "theme-color", content: "#c10007" },
      ],
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
        ...fontPreloads(matches),
        { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
        { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
        { rel: "manifest", href: "/site.webmanifest" },
      ],
    };
  },

  component: RootDocument,
  notFoundComponent: NotFound,
});

function RootDocument() {
  return (
    <html lang="th">
      <head>
        <HeadContent />
      </head>
      <body>
        <NavigationProgress />
        {/* min-h, not h: pages taller than the screen must grow the layout, not overflow it. */}
        <div className="flex min-h-svh text-foreground bg-background">
          {/*<Header />*/}
          <Outlet />
        </div>
        <Toaster richColors />
        <ConnectionStatus />
        <ViewModeBanner />
        <TanStackRouterDevtools position="bottom-left" />
        <Scripts />
      </body>
    </html>
  );
}
