import { buttonVariants } from "@it3k/ui/components/button";
import { cn } from "@it3k/ui/lib/utils";
import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { ArrowLeft, LogIn, RefreshCw, RotateCw } from "lucide-react";
import { type ReactNode, useCallback } from "react";

import { type ErrorKind, bodyUnder, describeError } from "@/lib/errors";

import { DictionaryEntry, Furigana } from "./dictionary-entry";
import { ErrorDetail, signInHref, useRetry, useRetryWhenOnline } from "./error-state";
import { LoadingButton } from "./loading-button";

type Entry = {
  word: string;
  pronunciation: string;
  aside: { phrase: ReactNode; romaji: string; meaning: string };
};

const SORRY: Entry = {
  word: "ผิดพลาด",
  pronunciation: "ผิด-พลาด",
  aside: { phrase: "すみません", romaji: "sumimasen", meaning: "ขออภัยนะ" },
};

/** Each kind of failure reads as its own dictionary entry, like the 404 page. */
const ENTRIES: Partial<Record<ErrorKind, Entry>> = {
  offline: {
    word: "ออฟไลน์",
    pronunciation: "ออฟ-ไลน์",
    aside: {
      phrase: <Furigana reading="けんがい">圏外</Furigana>,
      romaji: "kengai",
      meaning: "อยู่นอกพื้นที่สัญญาณ",
    },
  },
  network: {
    word: "ขาดการติดต่อ",
    pronunciation: "ขาด-กาน-ติด-ต่อ",
    aside: {
      phrase: (
        <>
          <Furigana reading="つうしん">通信</Furigana>エラー
        </>
      ),
      romaji: "tsūshin erā",
      meaning: "การสื่อสารขัดข้อง",
    },
  },
  server: {
    word: "5·0·0",
    pronunciation: "ไฟฟ์-โอ-โอ",
    aside: {
      phrase: (
        <>
          <Furigana reading="しょうしょう">少々</Furigana>お<Furigana reading="ま">待</Furigana>ち
        </>
      ),
      romaji: "shōshō omachi",
      meaning: "รอสักครู่นะ",
    },
  },
  outdated: {
    word: "อัปเดต",
    pronunciation: "อัป-เดต",
    aside: {
      phrase: (
        <>
          <Furigana reading="あたら">新</Furigana>しくなりました
        </>
      ),
      romaji: "atarashiku narimashita",
      meaning: "มีของใหม่แล้วนะ",
    },
  },
  signedOut: {
    word: "4·0·1",
    pronunciation: "โฟร์-โอ-วัน",
    aside: { phrase: "おかえりなさい", romaji: "okaerinasai", meaning: "ยินดีต้อนรับกลับ" },
  },
  forbidden: {
    word: "4·0·3",
    pronunciation: "โฟร์-โอ-ทรี",
    aside: {
      phrase: <Furigana reading="たちいりきんし">立入禁止</Furigana>,
      romaji: "tachiiri kinshi",
      meaning: "ห้ามเข้า",
    },
  },
  notFound: {
    word: "4·0·4",
    pronunciation: "โฟร์-โอ-โฟร์",
    aside: {
      phrase: (
        <>
          <Furigana reading="み">見</Furigana>つかりません
        </>
      ),
      romaji: "mitsukarimasen",
      meaning: "หาไม่เจอ",
    },
  },
  rateLimited: {
    word: "4·2·9",
    pronunciation: "โฟร์-ทู-ไนน์",
    aside: { phrase: "ゆっくりね", romaji: "yukkuri ne", meaning: "ช้า ๆ ก็ได้นะ" },
  },
};

/** Shown in place of a page whose loader or render failed, with the step that can fix it. */
export default function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const info = describeError(error);
  const entry = ENTRIES[info.kind] ?? SORRY;
  const tryAgain = useCallback(async () => {
    reset();
    await router.invalidate();
  }, [reset, router]);
  const [retrying, retry] = useRetry(tryAgain);
  useRetryWhenOnline(info, retry);

  const primary =
    info.action === "reload" ? (
      <LoadingButton loading={false} icon={RotateCw} onClick={() => window.location.reload()}>
        โหลดหน้าใหม่
      </LoadingButton>
    ) : info.action === "signIn" ? (
      <a href={signInHref()} className={buttonVariants()}>
        <LogIn data-icon="inline-start" aria-hidden />
        เข้าสู่ระบบอีกครั้ง
      </a>
    ) : info.retryable ? (
      <LoadingButton loading={retrying} icon={RefreshCw} onClick={() => void retry()}>
        {retrying ? "กำลังลองใหม่…" : "ลองอีกครั้ง"}
      </LoadingButton>
    ) : null;

  return (
    <div role="alert" data-error-kind={info.kind} className="flex flex-1 items-center py-16">
      <DictionaryEntry
        word={entry.word}
        pronunciation={entry.pronunciation}
        definitions={[
          <>
            <span className="font-semibold">{info.title}</span>
            <span className="text-muted-foreground"> — {bodyUnder(info, info.title)}</span>
          </>,
        ]}
        aside={entry.aside}
        action={<ErrorDetail detail={info.detail} className="mb-6 max-w-full" />}
        footer={
          <div className="flex flex-wrap items-center gap-2">
            {primary}
            <a href="/" className={cn(buttonVariants({ variant: "ghost" }), "cursor-pointer")}>
              <ArrowLeft size="1.2em" aria-hidden />
              กลับหน้าแรก
            </a>
          </div>
        }
      />
    </div>
  );
}
