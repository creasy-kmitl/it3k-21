import { ArrowDown, ArrowRight, Equal, Plus } from "lucide-react";
import { Children, Fragment, type ReactNode } from "react";

/**
 * Diagrams drawn with HTML and the theme's tokens, so they follow dark mode and
 * wrap on phones. No diagram library: the guide only needs boxes and arrows.
 */

type Tone = "default" | "primary" | "muted";

const toneClass: Record<Tone, string> = {
  default: "border-fd-border bg-fd-card",
  primary: "border-fd-primary/40 bg-fd-primary/10",
  muted: "border-dashed border-fd-border bg-fd-muted/50",
};

/** One box of a diagram. */
export function Node({
  title,
  tone = "default",
  children,
}: {
  title: ReactNode;
  tone?: Tone;
  children?: ReactNode;
}) {
  return (
    <div className={`min-w-0 flex-1 rounded-lg border px-3 py-2.5 ${toneClass[tone]}`}>
      <div className="text-sm font-semibold text-fd-foreground">{title}</div>
      {children ? (
        <div className="mt-1 text-xs leading-5 text-fd-muted-foreground">{children}</div>
      ) : null}
    </div>
  );
}

function Arrow({ label }: { label?: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col items-center justify-center gap-0.5 self-center text-fd-muted-foreground">
      <ArrowRight className="hidden size-4 md:block" aria-hidden />
      <ArrowDown className="size-4 md:hidden" aria-hidden />
      {label ? <span className="max-w-24 text-center text-[0.7rem] leading-4">{label}</span> : null}
    </div>
  );
}

/**
 * Boxes in a row joined by arrows (a column on phones). `labels` puts text on
 * the arrows, in order.
 */
export function Flow({ labels = [], children }: { labels?: ReactNode[]; children: ReactNode }) {
  const items = Children.toArray(children);
  return (
    <div className="not-prose my-6 flex flex-col items-stretch gap-2 md:flex-row">
      {items.map((item, i) => (
        <Fragment key={i}>
          {i > 0 ? <Arrow label={labels[i - 1]} /> : null}
          {item}
        </Fragment>
      ))}
    </div>
  );
}

/** A titled frame around diagrams, with an optional note under them. */
export function Diagram({
  title,
  note,
  children,
}: {
  title?: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="not-prose my-6 rounded-xl border bg-fd-background p-4">
      {title ? <div className="mb-1 text-sm font-semibold text-fd-foreground">{title}</div> : null}
      <div className="[&>div:first-child]:mt-2 [&>div:last-child]:mb-0">{children}</div>
      {note ? (
        <figcaption className="mt-3 text-xs leading-5 text-fd-muted-foreground">{note}</figcaption>
      ) : null}
    </figure>
  );
}

/** What a staff account may do = role + department + seat. */
export function RightsFormula() {
  const sign = "size-4 shrink-0 self-center text-fd-muted-foreground";
  return (
    <Diagram
      title="สิทธิ์ของบัญชีมาจาก 3 อย่างรวมกัน"
      note="ระบบอ่านทั้ง 3 อย่างจากฐานข้อมูลใหม่ทุกครั้งที่คุณกดหรือเปิดหน้า ถ้ามีคนเปลี่ยนสถานะ ฝ่าย หรือที่นั่งของคุณ สิทธิ์จะเปลี่ยนทันทีโดยไม่ต้องออกจากระบบ"
    >
      <div className="flex flex-col gap-2 md:flex-row">
        <Node title="บทบาทของบัญชี">
          guest · participant · athlete · <b>staff</b> · admin
        </Node>
        <Plus className={sign} aria-hidden />
        <Node title="ฝ่ายที่สังกัด">
          Tech/Live และทะเบียนได้สิทธิ์พิเศษ อีก 14 ฝ่ายได้สิทธิ์พื้นฐานเท่ากัน
        </Node>
        <Plus className={sign} aria-hidden />
        <Node title="ที่นั่ง (ถ้ามี)">หัวหน้าฝ่าย หรือรองหัวหน้าฝ่าย เฉพาะบัญชีของ สจล.</Node>
        <Equal className={sign} aria-hidden />
        <Node title="สิ่งที่คุณทำได้" tone="primary">
          เมนูและปุ่มที่เห็นในระบบทีมงาน
        </Node>
      </div>
    </Diagram>
  );
}

/** How a first Google sign-in becomes an account. */
export function SignupGate() {
  return (
    <Diagram
      title="เข้าสู่ระบบครั้งแรก"
      note="ระบบไม่มีการสมัครด้วยรหัสผ่าน และใช้ Discord เข้าสู่ระบบไม่ได้"
    >
      <Flow labels={["ตรวจอีเมล"]}>
        <Node title="กด “เข้าสู่ระบบด้วย Google”">เลือกบัญชี Google ของคุณ</Node>
        <div className="flex min-w-0 flex-[2] flex-col gap-2">
          <Node title="อีเมลสถาบัน" tone="primary">
            <code>kmitl.ac.th</code> <code>kmutt.ac.th</code> <code>kmutnb.ac.th</code>{" "}
            (รวมโดเมนย่อย) → สร้างบัญชีให้ทันทีเป็น guest
          </Node>
          <Node title="อีเมลอื่นที่มีคำเชิญ" tone="primary">
            สร้างบัญชีตามคำเชิญ: บทบาท ฝ่าย สถาบัน และที่นั่งตามที่ผู้เชิญกำหนด
          </Node>
          <Node title="อีเมลอื่นที่ไม่มีคำเชิญ" tone="muted">
            เข้าไม่ได้ ขึ้นข้อความ “อีเมลนี้ต้องได้รับคำเชิญก่อนเข้าใช้งาน”
          </Node>
        </div>
      </Flow>
    </Diagram>
  );
}

/** guest → participant → athlete, and the staff branch. */
export function AccountJourney() {
  return (
    <Diagram
      title="เส้นทางของบัญชี"
      note="บทบาท athlete และ staff ไม่ได้มาเอง ต้องมีผู้มีสิทธิ์กำหนดให้ในหน้า “ผู้ใช้” หรือส่งคำเชิญมา การอนุมัติใบสมัครกีฬาไม่ได้เปลี่ยนบทบาทของบัญชี"
    >
      <Flow labels={["ส่งโปรไฟล์", "ทะเบียน/Tech·Live กำหนด"]}>
        <Node title="guest" tone="muted">
          บัญชีใหม่ ยังไม่ได้กรอกโปรไฟล์
        </Node>
        <Node title="participant">ผู้เข้าร่วม รับตั๋วกิจกรรมได้</Node>
        <Node title="athlete">นักกีฬา สมัครแข่งกีฬาในนามสถาบัน</Node>
      </Flow>
      <Flow labels={["ได้รับสิทธิ์สตาฟ", "ได้ที่นั่ง (สจล.)"]}>
        <Node title="บัญชีใดก็ได้" tone="muted">
          หรือคำเชิญสตาฟ
        </Node>
        <Node title="staff" tone="primary">
          เข้าระบบทีมงาน /staff ได้ ตามฝ่ายที่สังกัด
        </Node>
        <Node title="หัวหน้า / รองหัวหน้า" tone="primary">
          สิทธิ์เพิ่มตามฝ่ายของที่นั่ง
        </Node>
      </Flow>
    </Diagram>
  );
}
