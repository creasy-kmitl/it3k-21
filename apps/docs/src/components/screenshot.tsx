import { ImageZoom } from "fumadocs-ui/components/image-zoom";

/**
 * A screenshot of the web app, taken by apps/docs/scripts/screenshots (see the
 * developers' "ภาพหน้าจอในคู่มือ" page). `src` is relative to public/screenshots,
 * without the extension. `mobile` adds the phone capture of the same page beside it.
 */
export function Screenshot({
  src,
  alt,
  caption,
  mobile,
}: {
  src?: string;
  alt: string;
  caption?: string;
  mobile?: string;
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
          <Frame label="คอมพิวเตอร์" wide>
            <ImageZoom
              src={`/screenshots/${src}.webp`}
              alt={alt}
              width={1440}
              height={900}
              className="!m-0 block h-auto w-full"
            />
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
