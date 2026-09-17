import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@it3k/ui/components/button";
import { cn } from "@it3k/ui/lib/utils";

export default function NotFound() {
  return (
    <div className="container mx-auto flex flex-col items-center justify-center px-6">
      <article className="w-full max-w-2xl">
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-5xl font-bold tracking-tight text-primary">
            4·0·4
          </h1>
          <span className="text-lg text-muted-foreground">/โฟร์-โอ-โฟร์/</span>
        </header>

        <p className="mt-2 text-sm italic text-muted-foreground">
          คำนาม <span className="not-italic">·</span> n.
        </p>

        <hr className="my-4 border-border" />

        <ol className="list-none space-y-3 mb-6">
          <li className="flex gap-3">
            <span className="font-bold text-primary">1.</span>
            <p className="leading-relaxed">
              หน้าที่คุณกำลังค้นหาไม่มีอยู่จริง หรืออาจถูกย้ายไปแล้ว
            </p>
          </li>
        </ol>

        <figure className="mb-10 border-l-4 border-primary bg-primary/5 py-5 pl-6 pr-4">
          <blockquote
            lang="ja"
            className="text-4xl font-bold tracking-wider text-primary sm:text-5xl"
          >
            <ruby>
              大変
              <rt className="pb-1 text-xs font-normal tracking-widest text-muted-foreground">
                たいへん
              </rt>
            </ruby>
            ですね
          </blockquote>
          <figcaption className="mt-3 text-sm text-muted-foreground">
            <span className="italic">taihen desu ne</span>
            <span className="mx-2">·</span>
            ลำบากแย่เลยนะ
          </figcaption>
        </figure>

        <footer className="flex items-center font-bold">
          <Link
            to="/"
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "cursor-pointer",
            )}
          >
            <ArrowLeft size={"1.2em"} />
            กลับหน้าแรก
          </Link>
        </footer>
      </article>
    </div>
  );
}
