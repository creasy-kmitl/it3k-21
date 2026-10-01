import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { cn } from "@it3k/ui/lib/utils";
import { DEFAULT_STATS_RANGE, STATS_RANGES, type StatsRange } from "@it3k/db/short-link-rules";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ChartColumn,
  CirclePause,
  CirclePlay,
  Clock,
  ExternalLink,
  History,
  LifeBuoy,
  LockKeyhole,
  Link2,
  type LucideIcon,
  Pencil,
  Plus,
  QrCode,
  ScanQrCode,
  Tag,
  UserRound,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { SideDrawer } from "@/components/calendar/side-drawer";
import { SegmentedControl } from "@/components/segmented-control";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import { ApiError } from "@/lib/leadership";
import {
  type ShortLinkChange,
  type ShortLinkDetail,
  type ShortLinkUpdate,
  linkError,
} from "@/lib/links";

import { LinkForm } from "./link-form";
import { CopyButton, LinkStateBadge, displayUrl } from "./link-parts";

const ACTION_LABELS: Record<ShortLinkChange["action"], { label: string; icon: LucideIcon }> = {
  create: { label: "สร้างลิงก์", icon: Plus },
  update: { label: "แก้ไข", icon: Pencil },
  enable: { label: "เปิดลิงก์", icon: CirclePlay },
  disable: { label: "ปิดลิงก์", icon: CirclePause },
};

const FIELD_LABELS: Record<string, string> = {
  title: "ชื่อ",
  destination: "ปลายทาง",
  slug: "ชื่อท้ายลิงก์",
  enabled: "สถานะ",
  expiresAt: "หมดอายุ",
  fallbackUrl: "ปลายทางสำรอง",
  tags: "แท็ก",
  password: "รหัสผ่าน",
};

function describe(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "ไม่มี";
  if (field === "enabled") return value ? "เปิด" : "ปิด";
  if (field === "password") return value ? "มี" : "ไม่มี";
  if (field === "expiresAt" && typeof value === "number") return formatBangkok(value, "dateTime");
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "ไม่มี";
  return String(value);
}

const STALE = "มีคนแก้ลิงก์นี้ก่อนคุณ ข้อมูลล่าสุดโหลดให้แล้ว";

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Icon aria-hidden className="size-4 text-primary" />
        {title}
      </h3>
      {children}
    </section>
  );
}

/** One URL with a copy button, e.g. the link for QR codes. */
function UrlRow({ label, url, children }: { label: string; url: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 truncate font-mono text-sm" title={url}>
          {displayUrl(url)}
        </code>
        <CopyButton text={url} label={label} />
      </div>
      {children}
    </div>
  );
}

const RANGE_SEGMENTS = STATS_RANGES.map((days) => ({ value: days, label: `${days} วัน` }));

/**
 * Visits per day over the chosen span, QR on the bottom of each bar and the
 * plain link above it. Counts are page opens, not people.
 */
function VisitChart({
  link,
  range,
  onRange,
}: {
  link: ShortLinkDetail;
  range: StatsRange;
  onRange: (range: StatsRange) => void;
}) {
  const max = Math.max(1, ...link.daily.map((day) => day.qr + day.link));
  const qrRecent = link.daily.reduce((sum, day) => sum + day.qr, 0);
  const plainRecent = link.daily.reduce((sum, day) => sum + day.link, 0);
  const first = link.daily[0];
  const last = link.daily.at(-1);
  const dayLabel = (day: string) => formatBangkok(Date.parse(`${day}T12:00:00+07:00`), "day");

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        label="ช่วงเวลา"
        segments={RANGE_SEGMENTS}
        value={range}
        onChange={onRange}
        className="self-start"
      />
      <dl className="grid grid-cols-2 gap-2">
        {[
          { label: "ผ่าน QR", icon: ScanQrCode, total: link.visits.qr, recent: qrRecent },
          { label: "ผ่านลิงก์", icon: Link2, total: link.visits.link, recent: plainRecent },
        ].map((stat) => (
          <div key={stat.label} className="flex flex-col gap-0.5 rounded-xl border p-3">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <stat.icon aria-hidden className="size-3.5" />
              {stat.label}
            </dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {stat.total.toLocaleString("th-TH")}
            </dd>
            <dd className="text-xs text-muted-foreground">
              {range} วันล่าสุด {stat.recent.toLocaleString("th-TH")}
            </dd>
          </div>
        ))}
      </dl>
      <div
        role="img"
        aria-label={`${range} วันล่าสุด เปิดผ่าน QR ${qrRecent} ครั้ง ผ่านลิงก์ ${plainRecent} ครั้ง`}
        className={cn("flex h-24 items-end", range > 30 ? "gap-px" : "gap-0.5")}
      >
        {link.daily.map((day) => (
          <div
            key={day.day}
            title={`${dayLabel(day.day)}: QR ${day.qr} · ลิงก์ ${day.link}`}
            className="flex h-full flex-1 flex-col justify-end"
          >
            <div
              className="rounded-t-sm bg-primary/35"
              style={{ height: `${(day.link / max) * 100}%` }}
            />
            <div
              className={cn("bg-primary", day.link === 0 && "rounded-t-sm")}
              style={{ height: `${(day.qr / max) * 100}%` }}
            />
            {day.qr + day.link === 0 && <div className="h-px bg-border" />}
          </div>
        ))}
      </div>
      {first && last && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{dayLabel(first.day)}</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span aria-hidden className="size-2 rounded-full bg-primary" />
              QR
            </span>
            <span className="flex items-center gap-1">
              <span aria-hidden className="size-2 rounded-full bg-primary/35" />
              ลิงก์
            </span>
          </span>
          <span>{dayLabel(last.day)}</span>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        นับจำนวนครั้งที่เปิดลิงก์ ไม่ใช่จำนวนคน ไม่รวมบอตและตัวแสดงตัวอย่างลิงก์ในแชต ไม่เก็บข้อมูลของผู้เปิด
      </p>
    </div>
  );
}

function ChangeLog({ changes }: { changes: ShortLinkChange[] }) {
  return (
    <ol className="flex flex-col gap-3" aria-label="ประวัติการเปลี่ยนแปลง">
      {changes.map((change) => {
        const { label, icon: Icon } = ACTION_LABELS[change.action];
        return (
          <li key={change.id} className="border-l-2 pl-3 text-xs">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1.5 font-medium">
                <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                {label}
              </span>
              <span className="flex items-center gap-1.5">
                <UserRound aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                {change.actorName ?? "ผู้ใช้ที่ถูกลบ"}
              </span>
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
              <Clock aria-hidden className="size-3.5 shrink-0" />
              {formatBangkok(change.createdAt, "dateTime")}
            </p>
            {change.action !== "create" && (
              <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
                {Object.entries(change.changes).map(([field, pair]) => {
                  const [before, after] = pair as [unknown, unknown];
                  return (
                    <li key={field} className="flex flex-wrap items-center gap-1.5 break-all">
                      <span className="font-medium text-foreground/80">
                        {FIELD_LABELS[field] ?? field}
                      </span>
                      <span className="line-through">{describe(field, before)}</span>
                      <ArrowRight aria-hidden className="size-3.5 shrink-0" />
                      <span className="sr-only">เป็น</span>
                      <span>{describe(field, after)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function LinkBody({
  link,
  range,
  onRange,
  knownTags,
}: {
  link: ShortLinkDetail;
  range: StatsRange;
  onRange: (range: StatsRange) => void;
  knownTags?: string[];
}) {
  const { links } = useApis();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmingOff, setConfirmingOff] = useState(false);

  const update = useMutation({
    mutationFn: (json: Omit<ShortLinkUpdate, "version">) =>
      links.update(link.id, { ...json, version: link.version }),
    onSuccess: async (_saved, json) => {
      setEditing(false);
      setConfirmingOff(false);
      toast.success(json.enabled === false ? "ปิดลิงก์แล้ว" : json.enabled ? "เปิดลิงก์แล้ว" : "บันทึกแล้ว");
      await queryClient.invalidateQueries({ queryKey: ["links"] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        toast.error(STALE);
        void queryClient.invalidateQueries({ queryKey: ["links"] });
      } else if (!linkError(error)) {
        toast.error(`บันทึกไม่สำเร็จ: ${error.message}`);
      }
    },
  });

  return (
    <div className="flex flex-col gap-6 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <LinkStateBadge state={link.state} />
        {link.expiresAt && (
          <span className="flex items-center gap-1.5 text-xs">
            <Clock aria-hidden className="size-3.5" />
            {link.state === "expired" ? "หมดอายุเมื่อ" : "หมดอายุ"}{" "}
            {formatBangkok(link.expiresAt, "dateTime")}
          </span>
        )}
        {link.owner && (
          <span className="flex items-center gap-1.5 text-xs">
            <UserRound aria-hidden className="size-3.5" />
            {link.owner.name}
          </span>
        )}
        {link.hasPassword && (
          <Badge variant="secondary">
            <LockKeyhole aria-hidden data-icon="inline-start" />
            มีรหัสผ่าน
          </Badge>
        )}
        {link.tags.map((tag) => (
          <Badge key={tag} variant="outline" className="text-muted-foreground">
            <Tag aria-hidden data-icon="inline-start" />
            {tag}
          </Badge>
        ))}
      </div>

      <Section icon={Link2} title="ลิงก์">
        <UrlRow label="ลิงก์สำหรับ QR" url={link.qrUrl}>
          <Button
            size="sm"
            className="mt-1 self-start"
            render={<Link to="/staff/qr-code" search={{ text: link.qrUrl }} />}
          >
            <QrCode data-icon="inline-start" />
            ออกแบบ QR จากลิงก์นี้
          </Button>
        </UrlRow>
        <UrlRow label="ลิงก์สำหรับแชร์เป็นข้อความ" url={link.shortUrl} />
        <div className="flex flex-col gap-1.5 rounded-xl border p-3">
          <span className="text-xs text-muted-foreground">พาไปที่</span>
          <a
            href={link.destination}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 break-all text-primary underline-offset-4 hover:underline"
          >
            {displayUrl(link.destination)}
            <ExternalLink aria-hidden className="size-3.5 shrink-0" />
          </a>
        </div>
        {link.fallbackUrl && (
          <div className="flex flex-col gap-1.5 rounded-xl border p-3">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LifeBuoy aria-hidden className="size-3.5" />
              ปลายทางสำรอง
              {link.state !== "active" && (
                <Badge variant="secondary" className="ml-auto">
                  ใช้อยู่ตอนนี้
                </Badge>
              )}
            </span>
            <a
              href={link.fallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 break-all text-primary underline-offset-4 hover:underline"
            >
              {displayUrl(link.fallbackUrl)}
              <ExternalLink aria-hidden className="size-3.5 shrink-0" />
            </a>
          </div>
        )}
      </Section>

      {link.canEdit &&
        (editing ? (
          <Section icon={Pencil} title="แก้ไขลิงก์">
            <LinkForm
              link={link}
              submitting={update.isPending}
              serverError={linkError(update.error)}
              knownTags={knownTags}
              onCancel={() => setEditing(false)}
              onSubmit={(values) =>
                update.mutate({
                  title: values.title,
                  destination: values.destination,
                  expiresAt: values.expiresAt,
                  fallbackUrl: values.fallbackUrl || null,
                  tags: values.tags,
                  ...(values.password !== undefined ? { password: values.password } : {}),
                })
              }
            />
          </Section>
        ) : confirmingOff ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-xl border border-amber-500/40 p-3 text-amber-800 dark:text-amber-300"
          >
            <p>
              {link.fallbackUrl
                ? "ปิดลิงก์นี้? QR และลิงก์ที่แชร์ไปแล้วจะพาไปปลายทางสำรองแทน เปิดกลับได้ทุกเมื่อ"
                : "ปิดลิงก์นี้? QR และลิงก์ที่แชร์ไปแล้วจะพาไปหน้าแจ้งว่าลิงก์ถูกปิด เปิดกลับได้ทุกเมื่อ"}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmingOff(false)}>
                ยกเลิก
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={update.isPending}
                onClick={() => update.mutate({ enabled: false })}
              >
                <CirclePause data-icon="inline-start" />
                ปิดลิงก์
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil data-icon="inline-start" />
              แก้ไข
            </Button>
            {link.enabled ? (
              <Button variant="outline" onClick={() => setConfirmingOff(true)}>
                <CirclePause data-icon="inline-start" />
                ปิดลิงก์
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={update.isPending}
                onClick={() => update.mutate({ enabled: true })}
              >
                <CirclePlay data-icon="inline-start" />
                เปิดลิงก์
              </Button>
            )}
          </div>
        ))}

      <Section icon={ChartColumn} title="การเข้าชม">
        <VisitChart link={link} range={range} onRange={onRange} />
      </Section>

      <Section icon={History} title="ประวัติ">
        <ChangeLog changes={link.changes} />
      </Section>
    </div>
  );
}

/** The side panel for one link: its URLs, visits, edits and history. */
export function LinkSheet({
  linkId,
  knownTags,
  onOpenChange,
}: {
  linkId: string | null;
  /** Tags on other links, offered while editing. */
  knownTags?: string[];
  onOpenChange: (open: boolean) => void;
}) {
  const { links } = useApis();
  const [range, setRange] = useState<StatsRange>(DEFAULT_STATS_RANGE);
  const detail = useQuery({
    queryKey: ["links", "detail", linkId, range],
    queryFn: () => links.get(linkId ?? "", range),
    enabled: linkId !== null,
    // The panel stays up while another range of the same link loads; another
    // link never shows through.
    placeholderData: (previous) => (previous?.id === linkId ? previous : undefined),
  });

  return (
    <SideDrawer
      open={linkId !== null}
      onOpenChange={onOpenChange}
      title={detail.data?.title ?? "ลิงก์"}
      width="32rem"
    >
      {detail.data ? (
        <LinkBody
          key={detail.data.id}
          link={detail.data}
          range={range}
          onRange={setRange}
          knownTags={knownTags}
        />
      ) : detail.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {detail.error instanceof ApiError && detail.error.status === 404
            ? "ไม่พบลิงก์นี้"
            : `โหลดลิงก์ไม่สำเร็จ: ${detail.error.message}`}
        </p>
      ) : (
        <div role="status" className="flex flex-col gap-3">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}
    </SideDrawer>
  );
}
