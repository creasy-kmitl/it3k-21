import type { ReactNode } from "react";

/**
 * The public pages' look: each reads like a dictionary entry, with the word,
 * how to say it, numbered meanings, and an optional Japanese aside.
 */
export function DictionaryEntry({
  word,
  pronunciation,
  definitions,
  aside,
  footer,
}: {
  word: string;
  /** Written between slashes, e.g. "โฟร์-โอ-โฟร์". */
  pronunciation: string;
  definitions: ReactNode[];
  /** A short Japanese phrase, its romaji and its meaning in Thai. */
  aside?: { phrase: ReactNode; romaji: string; meaning: string };
  footer?: ReactNode;
}) {
  return (
    <div className="container mx-auto flex flex-col items-center justify-center px-6">
      <article className="w-full max-w-2xl">
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-5xl font-bold tracking-tight text-primary">{word}</h1>
          <span className="text-lg text-muted-foreground">/{pronunciation}/</span>
        </header>

        <p className="mt-2 text-sm text-muted-foreground italic">
          คำนาม <span className="not-italic">·</span> n.
        </p>

        <hr className="my-4 border-border" />

        <ol className={aside ? "mb-6 list-none space-y-3" : "mb-10 list-none space-y-3"}>
          {definitions.map((definition, index) => (
            // The list is fixed per page, so its number is its identity.
            <li key={index} className="flex gap-3">
              <span className="font-bold text-primary">{index + 1}.</span>
              <p className="leading-relaxed">{definition}</p>
            </li>
          ))}
        </ol>

        {aside && (
          <figure className="mb-10 border-l-4 border-primary bg-primary/5 py-5 pr-4 pl-6">
            <blockquote
              lang="ja"
              className="text-4xl font-bold tracking-wider text-primary sm:text-5xl"
            >
              {aside.phrase}
            </blockquote>
            <figcaption className="mt-3 text-sm text-muted-foreground">
              <span className="italic">{aside.romaji}</span>
              <span className="mx-2">·</span>
              {aside.meaning}
            </figcaption>
          </figure>
        )}

        {footer && <footer className="flex flex-wrap items-center font-bold">{footer}</footer>}
      </article>
    </div>
  );
}

/** Ruby text over a Japanese word, sized for the aside. */
export function Furigana({ children, reading }: { children: ReactNode; reading: string }) {
  return (
    <ruby>
      {children}
      <rt className="pb-1 text-xs font-normal tracking-widest text-muted-foreground">{reading}</rt>
    </ruby>
  );
}
