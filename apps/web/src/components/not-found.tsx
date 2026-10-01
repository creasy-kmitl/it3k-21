import { buttonVariants } from "@it3k/ui/components/button";
import { cn } from "@it3k/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { DictionaryEntry, Furigana } from "./dictionary-entry";

export default function NotFound() {
  return (
    <DictionaryEntry
      word="4·0·4"
      pronunciation="โฟร์-โอ-โฟร์"
      definitions={["หน้าที่คุณกำลังค้นหาไม่มีอยู่จริง หรืออาจถูกย้ายไปแล้ว"]}
      aside={{
        phrase: (
          <>
            <Furigana reading="たいへん">大変</Furigana>
            ですね
          </>
        ),
        romaji: "taihen desu ne",
        meaning: "ลำบากแย่เลยนะ",
      }}
      footer={
        <Link to="/" className={cn(buttonVariants({ variant: "ghost" }), "cursor-pointer")}>
          <ArrowLeft size={"1.2em"} />
          กลับหน้าแรก
        </Link>
      }
    />
  );
}
