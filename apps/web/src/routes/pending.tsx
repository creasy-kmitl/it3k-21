import { Button, buttonVariants } from "@it3k/ui/components/button";
import { cn } from "@it3k/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, LogOut } from "lucide-react";

import { DictionaryEntry, Furigana } from "@/components/dictionary-entry";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/pending")({
  component: PendingPage,
  head: () => ({
    meta: [{ title: "รอสิทธิ์เข้าใช้งาน · IT3Kings" }, { name: "robots", content: "noindex" }],
  }),
});

/** Where a signed-in account lands while it is not yet staff. */
function PendingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return (
    <DictionaryEntry
      word="รอ·สิทธิ์"
      pronunciation="รอ-สิด"
      definitions={[
        "เข้าสู่ระบบสำเร็จแล้ว แต่บัญชีนี้ยังไม่มีสิทธิ์เข้าระบบทีมงาน",
        "แจ้งหัวหน้าฝ่ายหรือผู้ดูแลระบบให้กำหนดสิทธิ์ แล้วเข้าสู่ระบบอีกครั้ง",
      ]}
      aside={{
        phrase: (
          <>
            <Furigana reading="しょうしょう">少々</Furigana>お<Furigana reading="ま">待</Furigana>
            ちください
          </>
        ),
        romaji: "shōshō omachi kudasai",
        meaning: "รอสักครู่นะ",
      }}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => {
              void authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    queryClient.clear();
                    void navigate({ to: "/" });
                  },
                },
              });
            }}
          >
            <LogOut />
            ออกจากระบบ
          </Button>
          <Link to="/" className={cn(buttonVariants({ variant: "ghost" }), "cursor-pointer")}>
            <ArrowLeft size={"1.2em"} />
            กลับหน้าแรก
          </Link>
        </div>
      }
    />
  );
}
