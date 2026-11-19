import { ImageZoom } from "fumadocs-ui/components/image-zoom";

/**
 * A screenshot of the web app, taken by apps/docs/scripts/screenshots (see the
 * developers' "ภาพหน้าจอในคู่มือ" page). `src` is relative to public/screenshots,
 * without the extension. `mobile` adds the phone capture of the same page beside it.
 * `scroll` is for full-page captures far taller than the screen: they scroll inside
 * a frame of screen height instead of stretching the page.
 */
export function Screenshot({
  src,
  alt,
  caption,
  mobile,
  scroll,
}: {
  src?: string;
  alt: string;
  caption?: string;
  mobile?: string;
  scroll?: boolean;
}) {
  return (
    <figure className="not-prose my-6">
      <div
        className={
          src && mobile
            ? "grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)]"
            : "flex justify-center"
        }
      >
        {src ? (
          <Frame label={scroll ? "คอมพิวเตอร์ · เลื่อนในกรอบเพื่อดูทั้งหน้า" : "คอมพิวเตอร์"} wide>
            <div
              className={scroll ? "max-h-[28rem] overflow-y-auto overscroll-contain" : undefined}
            >
              <ImageZoom
                src={`/screenshots/${src}.webp`}
                alt={alt}
                width={1440}
                height={900}
                className="!m-0 block h-auto w-full"
              />
            </div>
          </Frame>
        ) : null}
        {mobile ? (
          <Frame label="มือถือ">
            <ImageZoom
              src={`/screenshots/${mobile}.webp`}
              alt={src ? `${alt} (มือถือ)` : alt}
              width={390}
              height={844}
              className="!m-0 block h-auto w-full"
            />
          </Frame>
        ) : null}
      </div>
      {caption ? (
        <figcaption className="mt-2 text-center text-sm text-fd-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

/**
 * The staff sidebar on its own (a 256×900 capture). Shown at about its real width,
 * because stretched to the column it would be three screens tall. Text passed as
 * children sits beside it on wide screens and below it on phones.
 */
export function SidebarShot({
  src,
  alt,
  children,
}: {
  src: string;
  alt: string;
  children?: React.ReactNode;
}) {
  const shot = (
    <figure className="not-prose m-0 w-56 shrink-0 overflow-hidden rounded-xl border bg-fd-muted p-1.5 shadow-sm">
      <ImageZoom
        src={`/screenshots/${src}.webp`}
        alt={alt}
        width={256}
        height={900}
        className="!m-0 block h-auto w-full rounded-lg"
      />
    </figure>
  );
  if (!children) return <div className="my-6 flex justify-center">{shot}</div>;
  return (
    <div className="my-6 flex flex-col items-center gap-6 sm:flex-row sm:items-start">
      {shot}
      <div className="min-w-0 flex-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div>
    </div>
  );
}

function Frame({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`overflow-hidden border bg-fd-muted shadow-sm ${
        wide ? "w-full rounded-lg" : "mx-auto w-full max-w-[13rem] rounded-[1.25rem] p-1.5"
      }`}
    >
      {wide ? (
        <div className="flex items-center gap-1.5 border-b px-3 py-2" aria-hidden>
          <span className="size-2.5 rounded-full bg-fd-border" />
          <span className="size-2.5 rounded-full bg-fd-border" />
          <span className="size-2.5 rounded-full bg-fd-border" />
          <span className="ms-2 text-xs text-fd-muted-foreground">{label}</span>
        </div>
      ) : null}
      <div className={wide ? "" : "overflow-hidden rounded-[0.9rem]"}>{children}</div>
    </div>
  );
}
