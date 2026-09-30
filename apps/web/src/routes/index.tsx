import { createFileRoute } from "@tanstack/react-router";
import { SiFacebook, SiInstagram } from "@icons-pack/react-simple-icons";
import { buttonVariants } from "@it3k/ui/components/button";
import { cn } from "@it3k/ui/lib/utils";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <div className="container mx-auto flex flex-col items-center justify-center px-6">
      <article className="w-full max-w-2xl">
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-5xl font-bold tracking-tight text-primary">
            IT·3·Kings
          </h1>
          <span className="text-lg text-muted-foreground">
            /ไอ-ที-สาม-คิงส์/
          </span>
        </header>

        <p className="mt-2 text-sm italic text-muted-foreground">
          คำนาม <span className="not-italic">·</span> n.
        </p>

        <hr className="my-4 border-border" />

        <ol className="list-none space-y-3 mb-10">
          <li className="flex gap-3">
            <span className="font-bold text-primary">1.</span>
            <p className="leading-relaxed">
              มหกรรมแข่งขันกีฬาสานสัมพันธ์ของนักศึกษาด้านเทคโนโลยีสารสนเทศจาก 3
              สถาบันพระจอมเกล้า (มจธ., มจพ. และ สจล.)
            </p>
          </li>
        </ol>

        <footer className="flex items-center font-bold">
          <a
            href="https://www.facebook.com/it3kofficial"
            target="_blank"
            rel="noopener"
            className={cn(buttonVariants({ variant: "ghost" }),"cursor-pointer")}
          >
            <SiFacebook size={"1.2em"} />
            IT3K
          </a>
          <a
            href="https://www.instagram.com/it3k.official"
            target="_blank"
            rel="noopener"
            className={cn(buttonVariants({ variant: "ghost" }),"cursor-pointer")}
          >
            <SiInstagram size={"1.2em"} />
            it3k.official
          </a>
        </footer>
      </article>
    </div>
  );
}
