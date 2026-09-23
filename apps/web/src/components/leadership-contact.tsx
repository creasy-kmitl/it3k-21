import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@it3k/ui/components/alert-dialog";
import { Button } from "@it3k/ui/components/button";
import { Spinner } from "@it3k/ui/components/spinner";
import { Contact } from "lucide-react";
import { useRef, useState } from "react";

import {
  type LeadershipApi,
  type LeadershipContact,
  type LeadershipSummary,
  leadershipApi,
} from "@/lib/leadership";

const PLATFORM_LABELS: Record<LeadershipContact["socials"][number]["platform"], string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  line: "LINE",
  discord: "Discord",
  other: "อื่น ๆ",
};

// The server only stores https links or plain handles; check again before
// turning a value into a link.
function isHttpsLink(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

type Stage =
  | { name: "confirm" }
  | { name: "loading" }
  | { name: "shown"; contact: LeadershipContact }
  | { name: "failed" };

/**
 * Contact details sit behind a warning. They are fetched only after the user
 * confirms (the server audits each fetch), held in local state -- never the
 * query cache -- and dropped when the dialog closes.
 */
export default function LeadershipContactButton({
  seat,
  api = leadershipApi,
}: {
  seat: LeadershipSummary;
  api?: LeadershipApi;
}) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>({ name: "confirm" });
  // Bumped on every close, so an answer to an earlier dialog is dropped
  // instead of showing details without a fresh confirmation.
  const session = useRef(0);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      session.current++;
      setStage({ name: "confirm" });
    }
  }

  async function reveal() {
    const current = session.current;
    setStage({ name: "loading" });
    try {
      const contact = await api.reveal(seat.id);
      if (session.current === current) setStage({ name: "shown", contact });
    } catch {
      if (session.current === current) setStage({ name: "failed" });
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`ช่องทางติดต่อ ${seat.displayName}`}
        onClick={() => setOpen(true)}
      >
        <Contact />
      </Button>
      <AlertDialogContent>
        {stage.name === "shown" ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{seat.displayName}</AlertDialogTitle>
            </AlertDialogHeader>
            <ContactDetails contact={stage.contact} />
            <AlertDialogFooter>
              <AlertDialogCancel>ปิด</AlertDialogCancel>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>ดูช่องทางติดต่อ</AlertDialogTitle>
              <AlertDialogDescription>
                การติดต่อฝ่ายอื่นควรติดต่อผ่าน Head เท่านั้น ยืนยันที่จะดูข้อมูลหรือไม่
              </AlertDialogDescription>
            </AlertDialogHeader>
            {stage.name === "failed" && (
              <p role="alert" className="text-sm text-destructive">
                ดูข้อมูลติดต่อไม่ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
              <AlertDialogAction disabled={stage.name === "loading"} onClick={() => void reveal()}>
                {stage.name === "loading" && <Spinner />}
                ยืนยัน
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ContactDetails({ contact }: { contact: LeadershipContact }) {
  if (!contact.phone && contact.socials.length === 0) {
    return <p className="text-sm text-muted-foreground">ยังไม่มีข้อมูลติดต่อ</p>;
  }
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      {contact.phone && (
        <>
          <dt className="text-muted-foreground">โทร</dt>
          <dd>
            <a href={`tel:${contact.phone.replace(/[^0-9+]/g, "")}`} className="underline">
              {contact.phone}
            </a>
          </dd>
        </>
      )}
      {contact.socials.map((social) => (
        <div key={social.platform} className="contents">
          <dt className="text-muted-foreground">{PLATFORM_LABELS[social.platform]}</dt>
          <dd className="break-all">
            {isHttpsLink(social.value) ? (
              <a
                href={social.value}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {social.value}
              </a>
            ) : (
              <span>{social.value}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
