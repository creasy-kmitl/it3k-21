import { Button } from "@it3k/ui/components/button";
import { Input } from "@it3k/ui/components/input";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  FileText,
  FlaskConical,
  GitBranch,
  GitPullRequest,
  Link,
  type LucideIcon,
  PenTool,
  Plus,
  ShieldCheck,
  ShieldOff,
  Siren,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import type {
  CalendarDependencyLink,
  CalendarItemDetail,
  CalendarSearchResult,
} from "@/lib/calendar";
import {
  CATEGORY_LABELS,
  QA_RESULT_LABELS,
  RELEASE_ENVIRONMENT_LABELS,
  STATUS_LABELS,
} from "@/lib/calendar-labels";
import { ApiError } from "@/lib/leadership";

function failure(error: Error) {
  return error instanceof ApiError && error.status === 409
    ? "มีคนแก้ไขก่อนคุณ โหลดข้อมูลล่าสุดให้แล้ว ลองอีกครั้ง"
    : `บันทึกไม่สำเร็จ: ${error.message}`;
}

function useRefreshingMutation<T>(run: (input: T) => Promise<unknown>, success: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => toast.success(success),
    onError: (error) => toast.error(failure(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["calendar"] }),
  });
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon aria-hidden className="size-4 text-primary" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Gate({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? (
        <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="ผ่าน" />
      ) : (
        <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="ยังไม่ผ่าน" />
      )}
      <span className="flex flex-col">
        <span>{label}</span>
        {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
      </span>
    </li>
  );
}

/** Everything a release needs before it may be marked released, and the approval. */
function ReleaseGates({ item }: { item: CalendarItemDetail }) {
  const { calendar } = useApis();
  const approve = useRefreshingMutation(
    (approved: boolean) =>
      calendar.update(item.id, { releaseApproved: approved, version: item.version }),
    "บันทึกการอนุมัติแล้ว",
  );
  const environment = item.environment as keyof typeof RELEASE_ENVIRONMENT_LABELS | null;
  const waiting = item.dependsOn.filter((link) => !link.satisfied).length;
  return (
    <Section title="ก่อนปล่อย release" icon={ShieldCheck}>
      <ul className="flex flex-col gap-1.5 rounded-xl border p-3">
        <Gate
          ok={!!environment}
          label="Environment"
          detail={
            environment ? (RELEASE_ENVIRONMENT_LABELS[environment] ?? environment) : undefined
          }
        />
        <Gate
          ok={item.qaResult === "passed"}
          label="ผล QA ผ่าน"
          detail={item.qaResult ? QA_RESULT_LABELS[item.qaResult] : "ยังไม่มีผล QA"}
        />
        <Gate
          ok={item.releaseApprovedAt !== null}
          label="อนุมัติ release"
          detail={
            item.releaseApprovedAt
              ? formatBangkok(item.releaseApprovedAt, "dateTime")
              : "หัวหน้า/รองหัวหน้า Tech/Live หรือ admin อนุมัติ"
          }
        />
        <Gate ok={!!item.rollbackPlan?.trim()} label="แผน rollback" />
        <Gate
          ok={item.monitoringOwner !== null}
          label="ผู้ดูแลการ monitor"
          detail={item.monitoringOwner?.name}
        />
        <Gate
          ok={waiting === 0}
          label="Dependency เสร็จครบ"
          detail={waiting > 0 ? `ยังรออีก ${waiting} รายการ` : undefined}
        />
      </ul>
      {item.canApprove && (
        <Button
          size="sm"
          variant={item.releaseApprovedAt ? "outline" : "default"}
          className="self-start"
          disabled={approve.isPending}
          onClick={() => approve.mutate(item.releaseApprovedAt === null)}
        >
          {item.releaseApprovedAt ? (
            <ShieldOff data-icon="inline-start" />
          ) : (
            <ShieldCheck data-icon="inline-start" />
          )}
          {item.releaseApprovedAt ? "ถอนการอนุมัติ" : "อนุมัติ release"}
        </Button>
      )}
      {item.rolloutPlan && (
        <div className="text-sm">
          <p className="font-medium">Rollout checklist</p>
          <p className="whitespace-pre-wrap text-muted-foreground">{item.rolloutPlan}</p>
        </div>
      )}
      {item.rollbackPlan && (
        <div className="text-sm">
          <p className="font-medium">แผน rollback</p>
          <p className="whitespace-pre-wrap text-muted-foreground">{item.rollbackPlan}</p>
        </div>
      )}
    </Section>
  );
}

function LinkRow({ link, canRemove }: { link: CalendarDependencyLink; canRemove: boolean }) {
  const { calendar } = useApis();
  const remove = useRefreshingMutation(() => calendar.removeDependency(link.id), "ลบแล้ว");
  return (
    <li className="flex items-start gap-2 p-2 text-sm">
      <span
        className={cn(
          "mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-semibold",
          link.satisfied ? "bg-emerald-600 text-white" : "bg-destructive text-white",
        )}
      >
        {link.satisfied ? "เสร็จแล้ว" : "ยังไม่เสร็จ"}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{link.item.title}</span>
        <span className="text-xs text-muted-foreground">
          {[
            CATEGORY_LABELS[link.item.category],
            STATUS_LABELS[link.item.status],
            link.item.owner && `ผู้รับผิดชอบ ${link.item.owner}`,
            formatBangkok(link.item.startAt, "dateTime"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {link.impact && <span className="text-xs">ผลกระทบ: {link.impact}</span>}
      </span>
      {canRemove && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`เลิกรอ ${link.item.title}`}
          disabled={remove.isPending}
          onClick={() => remove.mutate(undefined)}
        >
          <Trash2 />
        </Button>
      )}
    </li>
  );
}

function AddDependency({ item }: { item: CalendarItemDetail }) {
  const { calendar } = useApis();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<CalendarSearchResult>();
  const [impact, setImpact] = useState("");
  const q = useDebouncedValue(text.trim());
  const results = useQuery({
    queryKey: ["calendar", "search", q],
    queryFn: () => calendar.search(q),
    enabled: q.length > 0 && !picked,
  });
  const add = useRefreshingMutation(
    () => calendar.addDependency(item.id, picked?.id ?? "", impact.trim() || null),
    "เพิ่ม dependency แล้ว",
  );
  const options = (results.data?.items ?? []).filter(
    (result) => result.id !== item.id && !item.dependsOn.some((link) => link.item.id === result.id),
  );
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed p-3">
      {picked ? (
        <p className="flex items-center gap-2 text-sm">
          รอ: <span className="font-medium">{picked.title}</span>
          <Button variant="ghost" size="sm" onClick={() => setPicked(undefined)}>
            เปลี่ยน
          </Button>
        </p>
      ) : (
        <>
          <Input
            aria-label="ค้นหารายการที่ต้องรอ"
            placeholder="ค้นหารายการที่ต้องรอ"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {options.length > 0 && (
            <ul className="flex flex-col rounded-lg border" aria-label="ผลการค้นหา">
              {options.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    className="w-full px-2 py-1.5 text-left text-sm hover:bg-muted"
                    onClick={() => setPicked(option)}
                  >
                    {option.title}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {STATUS_LABELS[option.status]} · {formatBangkok(option.startAt, "day")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <Input
        aria-label="ผลกระทบถ้าล่าช้า"
        placeholder="ผลกระทบถ้าล่าช้า เช่น stream slot 18:00"
        value={impact}
        onChange={(e) => setImpact(e.target.value)}
        maxLength={300}
      />
      <Button
        size="sm"
        className="self-end"
        disabled={!picked || add.isPending}
        onClick={() =>
          add.mutate(undefined, {
            onSuccess: () => {
              setPicked(undefined);
              setText("");
              setImpact("");
            },
          })
        }
      >
        <Plus data-icon="inline-start" />
        เพิ่ม dependency
      </Button>
    </div>
  );
}

function ExternalLinks({ item }: { item: CalendarItemDetail }) {
  const candidates: [string, LucideIcon, string | null][] = [
    ["Spec", FileText, item.specUrl],
    ["Design", PenTool, item.designUrl],
    ["Pull request", GitPullRequest, item.pullRequestUrl],
    ["ผล QA", FlaskConical, item.qaUrl],
    ["Incident", Siren, item.incidentUrl],
  ];
  const links = candidates.filter(
    (entry): entry is [string, LucideIcon, string] => entry[2] !== null,
  );
  if (links.length === 0) return null;
  return (
    <Section title="ลิงก์" icon={Link}>
      <ul className="flex flex-wrap gap-2 text-sm">
        {links.map(([label, Icon, href]) => (
          <li key={label}>
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-primary underline"
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Release gates, links, and what the item waits on or holds up. */
export function DeliveryPanel({ item }: { item: CalendarItemDetail }) {
  return (
    <div className="flex flex-col gap-6">
      {item.category === "release" && <ReleaseGates item={item} />}
      <ExternalLinks item={item} />
      <Section title="รอรายการ" icon={GitBranch}>
        {item.dependsOn.length > 0 ? (
          <ul className="flex flex-col divide-y rounded-xl border">
            {item.dependsOn.map((link) => (
              <LinkRow key={link.id} link={link} canRemove={item.canEdit} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">ไม่ได้รอรายการอื่น</p>
        )}
        {item.canEdit && <AddDependency item={item} />}
      </Section>
      {item.blocks.length > 0 && (
        <Section title="รายการที่รออันนี้" icon={Workflow}>
          <ul className="flex flex-col divide-y rounded-xl border">
            {item.blocks.map((link) => (
              <LinkRow key={link.id} link={link} canRemove={false} />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
