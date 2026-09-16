import { Toaster } from "@it3k/ui/components/sonner";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import Header from "../components/header";
import { getOrigin } from "../functions/get-origin";

import appCss from "../index.css?url";

export interface RouterAppContext {}

const SITE_TITLE = "IT3Kings";
const SITE_DESCRIPTION =
  "มหกรรมแข่งขันกีฬาสานสัมพันธ์ของนักศึกษาด้านเทคโนโลยีสารสนเทศจาก 3 สถาบันพระจอมเกล้า (มจธ., มจพ. และ สจล.)";

export const Route = createRootRouteWithContext<RouterAppContext>()({
  loader: () => ({ origin: getOrigin() }),
  head: ({ loaderData }) => {
    const ogImage = `${loaderData?.origin ?? ""}/og.png`;

    return {
      meta: [
        {
          charSet: "utf-8",
        },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1",
        },
        {
          title: SITE_TITLE,
        },
        { name: "description", content: SITE_DESCRIPTION },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: SITE_TITLE },
        { property: "og:title", content: SITE_TITLE },
        { property: "og:description", content: SITE_DESCRIPTION },
        { property: "og:url", content: loaderData?.origin },
        { property: "og:image", content: ogImage },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: `${SITE_TITLE} — ${SITE_DESCRIPTION}` },
        { property: "og:locale", content: "th_TH" },
        { name: "theme-color", content: "#c10007" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: SITE_TITLE },
        { name: "twitter:description", content: SITE_DESCRIPTION },
        { name: "twitter:image", content: ogImage },
      ],
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
        { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
        { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
        { rel: "manifest", href: "/site.webmanifest" },
      ],
    };
  },

  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="flex h-screen text-foreground bg-background">
          {/*<Header />*/}
          <Outlet />
        </div>
        <Toaster richColors />
        <TanStackRouterDevtools position="bottom-left" />
        <Scripts />
      </body>
    </html>
  );
}
