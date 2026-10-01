import { buttonVariants } from "@it3k/ui/components/button";
import { cn } from "@it3k/ui/lib/utils";
import {
  LINK_UNAVAILABLE_HEADER,
  LINK_UNLOCK_HEADER,
  type LinkPageReason,
  PASSWORD_MAX,
  type UnlockFailure,
  isLinkPageReason,
  isUnlockFailure,
} from "@it3k/db/short-link-rules";
import { SiFacebook } from "@icons-pack/react-simple-icons";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, KeyRound, OctagonX } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "@it3k/ui/components/button";
import { Input } from "@it3k/ui/components/input";

import { DictionaryEntry, Furigana } from "@/components/dictionary-entry";

// A short link that sends nobody on. `/l/<slug>` never reaches this app for
// a live link: the web worker hands it to the API, which redirects. When the
// API says no, the worker renders this route at the same address, under the
// API's 404 or 410 (or a 503 when the API could not answer), and passes the
// reason in LINK_UNAVAILABLE_HEADER.

type PageState = { reason: LinkPageReason; unlock: UnlockFailure | null };

/** The reason the worker passed. Read while rendering on the server; the
 * browser gets it with the page, so the client side is only a fallback. */
const pageState = createIsomorphicFn()
  .server((): PageState => {
    const reason = getRequestHeader(LINK_UNAVAILABLE_HEADER);
    const unlock = getRequestHeader(LINK_UNLOCK_HEADER);
    return {
      reason: isLinkPageReason(reason) ? reason : "missing",
      unlock: isUnlockFailure(unlock) ? unlock : null,
    };
  })
  .client((): PageState => ({ reason: "missing", unlock: null }));

const UNLOCK_MESSAGES: Record<UnlockFailure, string> = {
  wrong: "รหัสผ่านไม่ถูกต้อง ลองอีกครั้ง",
  limited: "มีคนลองรหัสผิดหลายครั้งเกินไป รอประมาณหนึ่งนาทีแล้วลองใหม่",
};

/**
 * A plain form posting to this same address, query included, so the visit
 * still counts as a QR scan when it came from one. It works before the page's
 * script loads.
 */
function UnlockForm({ failure }: { failure: UnlockFailure | null }) {
  return (
    <form method="post" className="mb-10 flex max-w-sm flex-col gap-2">
      <label htmlFor="link-password" className="flex items-center gap-2 text-sm font-medium">
        <KeyRound aria-hidden className="size-4 text-primary" />
        รหัสผ่าน
      </label>
      <div className="flex gap-2">
        <Input
          id="link-password"
          name="password"
          type="password"
          required
          maxLength={PASSWORD_MAX}
          autoComplete="off"
          autoFocus
          aria-invalid={failure !== null}
          aria-describedby={failure ? "link-password-error" : undefined}
        />
        <Button type="submit">
          ไปต่อ
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
      {failure && (
        <p
          id="link-password-error"
          role="alert"
          className="flex items-center gap-1.5 text-sm text-destructive"
        >
          <OctagonX aria-hidden className="size-4 shrink-0" />
          {UNLOCK_MESSAGES[failure]}
        </p>
      )}
    </form>
  );
}

const ENTRIES: Record<LinkPageReason, ComponentProps<typeof DictionaryEntry>> = {
  missing: {
    word: "4·0·4",
    pronunciation: "โฟร์-โอ-โฟร์",
    definitions: [
      "ลิงก์นี้ไม่มีอยู่จริง อาจพิมพ์ผิด หรือไม่เคยถูกสร้าง",
      "ถ้าพิมพ์จากโปสเตอร์ ลองเช็กตัวอักษรอีกครั้ง หรือสแกน QR แทน",
    ],
    aside: {
      phrase: (
        <>
          <Furigana reading="たいへん">大変</Furigana>
          ですね
        </>
      ),
      romaji: "taihen desu ne",
      meaning: "ลำบากแย่เลยนะ",
    },
  },
  disabled: {
    word: "ปิด·แล้ว",
    pronunciation: "ปิด-แล้ว",
    definitions: ["ทีมงาน IT3K ปิดลิงก์นี้ไว้ ตอนนี้จึงยังพาไปไหนไม่ได้", "ติดต่อผู้ที่ให้ลิงก์หรือ QR นี้มา เพื่อขอลิงก์ใหม่"],
    aside: {
      phrase: (
        <>
          お<Furigana reading="やす">休</Furigana>み<Furigana reading="ちゅう">中</Furigana>
        </>
      ),
      romaji: "oyasumi-chū",
      meaning: "พักอยู่นะ",
    },
  },
  expired: {
    word: "หมด·อายุ",
    pronunciation: "หมด-อา-ยุ",
    definitions: [
      "ลิงก์นี้ใช้ได้ถึงวันที่ทีมงานกำหนดไว้เท่านั้น และเลยมาแล้ว",
      "ติดต่อผู้ที่ให้ลิงก์หรือ QR นี้มา เพื่อขอลิงก์ใหม่",
    ],
    aside: {
      phrase: (
        <>
          <Furigana reading="きげん">期限</Furigana>
          <Furigana reading="ぎ">切</Furigana>れ
        </>
      ),
      romaji: "kigengire",
      meaning: "หมดเวลาแล้ว",
    },
  },
  error: {
    word: "ขัด·ข้อง",
    pronunciation: "ขัด-ข้อง",
    definitions: [
      "ระบบลิงก์ของ IT3K ขัดข้องชั่วคราว ลิงก์นี้ยังอยู่ ไม่ได้หายไปไหน",
      "ลองสแกนหรือเปิดใหม่อีกครั้งในอีกสักครู่",
    ],
    aside: {
      phrase: (
        <>
          <Furigana reading="しょうしょう">少々</Furigana>お<Furigana reading="ま">待</Furigana>
          ちください
        </>
      ),
      romaji: "shōshō omachi kudasai",
      meaning: "รอสักครู่นะ",
    },
  },
  locked: {
    word: "ล็อก·ไว้",
    pronunciation: "ล็อก-ไว้",
    definitions: [
      "ลิงก์นี้ต้องใช้รหัสผ่าน ทีมงานตั้งไว้ให้เฉพาะคนที่ได้รับรหัส",
      "ใส่รหัสที่ได้จากทีมงานด้านล่าง แล้วระบบจะพาไปต่อ",
    ],
    aside: {
      phrase: (
        <>
          <Furigana reading="あいことば">合言葉</Furigana>は？
        </>
      ),
      romaji: "aikotoba wa?",
      meaning: "รหัสลับล่ะ?",
    },
  },
};

export const Route = createFileRoute("/l/$slug")({
  loader: () => pageState(),
  head: () => ({
    meta: [{ title: "ลิงก์นี้ใช้ไม่ได้ · IT3Kings" }, { name: "robots", content: "noindex" }],
  }),
  component: LinkUnavailable,
});

function LinkUnavailable() {
  const { reason, unlock } = Route.useLoaderData();
  return (
    <DictionaryEntry
      {...ENTRIES[reason]}
      action={reason === "locked" ? <UnlockForm failure={unlock} /> : undefined}
      footer={
        <>
          <Link to="/" className={cn(buttonVariants({ variant: "ghost" }), "cursor-pointer")}>
            <ArrowLeft size={"1.2em"} />
            กลับหน้าแรก
          </Link>
          <a
            href="https://www.facebook.com/it3kofficial"
            target="_blank"
            rel="noopener"
            className={cn(buttonVariants({ variant: "ghost" }), "cursor-pointer")}
          >
            <SiFacebook size={"1.2em"} />
            ถามทีมงาน IT3K
          </a>
        </>
      }
    />
  );
}
