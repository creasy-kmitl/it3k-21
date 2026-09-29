import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@it3k/ui/components/alert-dialog";
import { Button } from "@it3k/ui/components/button";
import { Spinner } from "@it3k/ui/components/spinner";
import {
  AtSign,
  Contact,
  Copy,
  Eye,
  ExternalLink,
  Gamepad2,
  Link,
  type LucideIcon,
  MessageCircle,
  Phone,
  ShieldAlert,
  UserRoundX,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  type LeadershipApi,
  type LeadershipContact,
  type LeadershipDepartment,
  type LeadershipSummary,
  leadershipApi,
} from "@/lib/leadership";

import { DepartmentBadge } from "./department-icon";
import { RoleBadge } from "./leadership-list";

type Platform = LeadershipContact["socials"][number]["platform"];

const PLATFORM_ICONS: Record<Platform, LucideIcon> = {
  facebook: AtSign,
  instagram: AtSign,
  line: MessageCircle,
  discord: Gamepad2,
  other: Link,
};

const PLATFORM_LABELS: Record<Platform, string> = {
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

/** `https://www.facebook.com/oat/` reads as `facebook.com/oat`. */
function displayLink(value: string) {
  const url = new URL(value);
  const path = url.pathname.replace(/\/$/, "");
  return `${url.hostname.replace(/^www\./, "")}${path}${url.search}`;
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
  department,
  api = leadershipApi,
}: {
  seat: LeadershipSummary;
  /** The seat's department, for its icon and color; plain when not loaded yet. */
  department?: LeadershipDepartment;
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
      <AlertDialogContent className="grid-cols-[minmax(0,1fr)]">
        {stage.name === "shown" ? (
          <>
            <AlertDialogHeader className="flex flex-row items-start gap-4 text-left">
              <AlertDialogMedia className="mb-0 size-12 shrink-0 bg-primary/10 text-primary">
                <Contact className="size-6" />
              </AlertDialogMedia>
              <div className="flex min-w-0 flex-col gap-1.5">
                <AlertDialogTitle>{seat.displayName}</AlertDialogTitle>
                <AlertDialogDescription
                  render={<div />}
                  className="flex flex-wrap items-center gap-2"
                >
                  <RoleBadge kind={seat.role} />
                  <DepartmentBadge
                    department={
                      department ?? { name: seat.departmentName, icon: "folder", color: "slate" }
                    }
                  />
                </AlertDialogDescription>
              </div>
            </AlertDialogHeader>
            <ContactDetails contact={stage.contact} />
            <AlertDialogFooter>
              <AlertDialogCancel className="sm:min-w-24">
                <X data-icon="inline-start" aria-hidden />
                ปิด
              </AlertDialogCancel>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader className="flex flex-row items-start gap-4 text-left">
              <AlertDialogMedia className="mb-0 size-12 shrink-0 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <ShieldAlert className="size-6" />
              </AlertDialogMedia>
              <div className="flex min-w-0 flex-col gap-1.5">
                <AlertDialogTitle>ดูช่องทางติดต่อ</AlertDialogTitle>
                <AlertDialogDescription>
                  การติดต่อฝ่ายอื่นควรติดต่อผ่าน Head เท่านั้น ยืนยันที่จะดูข้อมูลหรือไม่
                </AlertDialogDescription>
              </div>
            </AlertDialogHeader>
            {stage.name === "failed" && (
              <p role="alert" className="text-sm text-destructive">
                ดูข้อมูลติดต่อไม่ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>
                <X data-icon="inline-start" aria-hidden />
                ยกเลิก
              </AlertDialogCancel>
              <AlertDialogAction disabled={stage.name === "loading"} onClick={() => void reveal()}>
                {stage.name === "loading" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Eye data-icon="inline-start" aria-hidden />
                )}
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
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        <UserRoundX className="size-5" aria-hidden />
        <p>ยังไม่มีข้อมูลติดต่อ</p>
      </div>
    );
  }
  return (
    <ul className="flex min-w-0 flex-col gap-2">
      {contact.phone && (
        <ContactRow
          icon={Phone}
          label="โทร"
          value={contact.phone}
          href={`tel:${contact.phone.replace(/[^0-9+]/g, "")}`}
        />
      )}
      {contact.socials.map((social) => {
        const link = isHttpsLink(social.value);
        return (
          <ContactRow
            key={social.platform}
            icon={PLATFORM_ICONS[social.platform]}
            label={PLATFORM_LABELS[social.platform]}
            value={social.value}
            display={link ? displayLink(social.value) : undefined}
            href={link ? social.value : undefined}
            external={link}
          />
        );
      })}
    </ul>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
  display = value,
  href,
  external = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  display?: string;
  href?: string;
  external?: boolean;
}) {
  const body = (
    <>
      <span
        aria-hidden
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground ring-1 ring-foreground/5 [&_svg]:size-4"
      >
        <Icon />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="truncate font-medium">{display}</span>
      </span>
      {external && <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
    </>
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`คัดลอก${label}แล้ว`);
    } catch {
      toast.error("คัดลอกไม่สำเร็จ");
    }
  }

  return (
    <li className="flex items-center gap-1 rounded-2xl bg-muted/60 p-1.5 text-sm">
      {href ? (
        <a
          href={href}
          title={value}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 outline-none hover:bg-background/60 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {body}
        </a>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 p-1">{body}</div>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`คัดลอก${label}`}
        onClick={() => void copy()}
      >
        <Copy />
      </Button>
    </li>
  );
}
