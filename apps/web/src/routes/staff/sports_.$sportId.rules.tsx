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
import { Skeleton } from "@it3k/ui/components/skeleton";
import { cn } from "@it3k/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useBlocker, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ScrollText } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { RulesEditor } from "@/components/rules-editor";
import { useApis } from "@/lib/api-context";

const searchSchema = z.object({
  division: z.string().min(1).optional().catch(undefined),
});

export const Route = createFileRoute("/staff/sports_/$sportId/rules")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({ meta: [{ title: "กติกา · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { sportId } = Route.useParams();
  const { division } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [dirty, setDirty] = useState(false);
  // Leaving, or switching to another division, would drop the draft.
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  return (
    <>
      <SportRulesPage
        sportId={sportId}
        divisionId={division}
        onSelect={(next) => navigate({ search: { division: next }, replace: true })}
        onDirtyChange={setDirty}
      />
      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => !open && blocker.reset?.()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ทิ้งกติกาที่ยังไม่ได้บันทึก?</AlertDialogTitle>
            <AlertDialogDescription>สิ่งที่แก้ไว้จะหายไป ดาวน์โหลด .md เก็บไว้ก่อนได้</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>แก้ต่อ</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>
              ทิ้ง
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * A sport's rules and each of its divisions' own rules, one at a time. A
 * division without its own shows the sport's. The API decides who may edit.
 */
export function SportRulesPage({
  sportId,
  divisionId,
  onSelect,
  onDirtyChange,
}: {
  sportId: string;
  divisionId?: string;
  onSelect: (divisionId: string | undefined) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { sportRules: api } = useApis();
  const queryClient = useQueryClient();
  const sport = useQuery({
    queryKey: ["sport-rules", "sport", sportId],
    queryFn: () => api.sport(sportId),
  });
  const division = useQuery({
    queryKey: ["sport-rules", "division", divisionId],
    queryFn: () => api.division(divisionId ?? ""),
    enabled: divisionId !== undefined,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["sport-rules"] });

  const current = divisionId === undefined ? sport : division;
  const chosen = sport.data?.divisions.find((item) => item.id === divisionId);

  return (
    <div className="flex flex-1 flex-col gap-4 sm:gap-6">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 self-start"
        render={<Link to="/staff/sports" />}
        nativeButton={false}
      >
        <ArrowLeft data-icon="inline-start" aria-hidden /> กีฬาทั้งหมด
      </Button>

      {sport.isPending ? (
        <div role="status" className="flex flex-col gap-3">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : sport.isError ? (
        <ErrorState error={sport.error} onRetry={sport.refetch} title="โหลดกติกาไม่สำเร็จ" />
      ) : (
        <>
          <PageHeader
            icon={ScrollText}
            title={`กติกา${sport.data.sport.name}`}
            description="กติกาของกีฬาใช้กับทุกประเภท เว้นแต่ประเภทนั้นมีกติกาของตัวเอง"
          />

          <nav aria-label="เลือกกติกา" className="-mx-4 overflow-x-auto px-4">
            <ul className="flex w-max gap-2">
              <li>
                <ScopeChip
                  label="ทั้งกีฬา"
                  active={divisionId === undefined}
                  marked={sport.data.rules !== null}
                  onClick={() => onSelect(undefined)}
                />
              </li>
              {sport.data.divisions.map((item) => (
                <li key={item.id}>
                  <ScopeChip
                    label={item.name}
                    active={item.id === divisionId}
                    marked={item.hasOwnRules}
                    onClick={() => onSelect(item.id)}
                  />
                </li>
              ))}
            </ul>
          </nav>

          {divisionId !== undefined && !chosen ? (
            <ErrorState error={new Error("ไม่พบประเภทนี้ในกีฬานี้")} title="ไม่พบประเภทนี้" />
          ) : current.isPending ? (
            <Skeleton role="status" aria-label="กำลังโหลด" className="h-80 w-full" />
          ) : current.isError ? (
            <ErrorState error={current.error} onRetry={current.refetch} title="โหลดกติกาไม่สำเร็จ" />
          ) : divisionId === undefined ? (
            <RulesEditor
              key="sport"
              saved={sport.data.rules}
              canEdit={sport.data.canEdit}
              fileName={`${sport.data.sport.code}.md`}
              emptyText="กีฬานี้ยังไม่มีกติกา"
              removeLabel="ลบกติกา"
              onSave={async (input) => {
                await api.saveSport(sportId, input);
                await refresh();
              }}
              onDirtyChange={onDirtyChange}
            />
          ) : (
            division.data && (
              <RulesEditor
                key={divisionId}
                saved={division.data.rules}
                fallback={
                  division.data.sportRules
                    ? { label: "กติกาของกีฬา", markdown: division.data.sportRules.markdown }
                    : null
                }
                canEdit={division.data.canEdit}
                fileName={`${sport.data.sport.code}-${chosen?.name ?? "division"}.md`}
                emptyText="ประเภทนี้และกีฬานี้ยังไม่มีกติกา"
                removeLabel="กลับไปใช้กติกาของกีฬา"
                onSave={async (input) => {
                  await api.saveDivision(divisionId, input);
                  await refresh();
                }}
                onDirtyChange={onDirtyChange}
              />
            )
          )}
        </>
      )}
    </div>
  );
}

function ScopeChip({
  label,
  active,
  marked,
  onClick,
}: {
  label: string;
  active: boolean;
  marked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
      )}
    >
      {label}
      {marked && (
        <span
          role="img"
          aria-label="มีกติกาของตัวเอง"
          className={cn("size-1.5 rounded-full", active ? "bg-primary-foreground" : "bg-primary")}
        />
      )}
    </button>
  );
}
