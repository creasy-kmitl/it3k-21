import { botTokenInput } from "@it3k/db/bot-token-rules";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@it3k/ui/components/alert-dialog";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Ban, Bot, KeyRound, Plus, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { FormDialog, TextField, issuesOf } from "@/components/form-dialog";
import { CopyButton } from "@/components/links/link-parts";
import { LoadingButton } from "@/components/loading-button";
import { PageHeader } from "@/components/page-header";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import type { BotToken, IssuedBotToken } from "@/lib/bot-tokens";
import { toastError } from "@/lib/errors";
import { ApiError } from "@/lib/leadership";
import { useMe } from "@/lib/users";

export const Route = createFileRoute("/staff/bot-tokens")({
  component: BotTokensPage,
});

const KEY = ["bot-tokens"] as const;

type Dialog =
  | { kind: "issue" }
  | { kind: "issued"; token: IssuedBotToken }
  | { kind: "revoke"; token: BotToken };

const when = (value: string | null) => (value ? formatBangkok(Date.parse(value), "dateTime") : "—");

/**
 * Tokens the Discord bots send to /api/bot/*. Admins issue one per bot and
 * stage, copy it once into the bot's .env, and revoke it if it leaks. The
 * API stores only a hash, so a lost token cannot be shown again: issue a new one.
 */
export function BotTokensPage() {
  const apis = useApis();
  const queryClient = useQueryClient();
  const me = useMe(apis.users);
  const allowed = !!me.data?.canManageBotTokens;
  const tokens = useQuery({
    queryKey: KEY,
    queryFn: () => apis.botTokens.list(),
    enabled: allowed,
  });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string>();

  const issue = useMutation({
    mutationFn: (input: { name: string }) => apis.botTokens.issue(input),
    onSuccess: (token) => {
      setDialog({ kind: "issued", token });
      setName("");
    },
    onError: (error) => toastError(error, "ออก token ไม่สำเร็จ"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apis.botTokens.revoke(id),
    onSuccess: () => {
      toast.success("เพิกถอน token แล้ว");
      setDialog(null);
    },
    onError: (error) => toastError(error, "เพิกถอนไม่สำเร็จ"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });

  const submitIssue = () => {
    const parsed = botTokenInput.safeParse({ name });
    if (!parsed.success) {
      setNameError(issuesOf(parsed.error).name);
      return;
    }
    setNameError(undefined);
    issue.mutate(parsed.data);
  };

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <PageHeader
        icon={Bot}
        title="Bot token"
        description="token ที่บอท Discord ใช้เรียก API ของเว็บ stage นี้ ออกหนึ่ง token ต่อบอท แล้วนำไปใส่ใน .env ของบอท"
      />
      {allowed && (
        <Button onClick={() => setDialog({ kind: "issue" })}>
          <Plus data-icon="inline-start" aria-hidden />
          ออก token ใหม่
        </Button>
      )}
    </div>
  );

  if (me.isPending) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (me.isError || !allowed) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <ErrorState
          error={me.error ?? new ApiError(403, "เฉพาะผู้ดูแลระบบที่จัดการ bot token ได้")}
          onRetry={me.isError ? me.refetch : undefined}
        />
      </div>
    );
  }

  const items = tokens.data?.items ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6">
      {header}

      {tokens.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : tokens.isError ? (
        <ErrorState
          error={tokens.error}
          onRetry={tokens.refetch}
          title="โหลดรายการ token ไม่สำเร็จ"
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="ยังไม่มี token"
          description="ออก token ให้บอทก่อน บอทจึงจะเรียก /api/bot ของ stage นี้ได้"
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card" aria-label="bot token">
          {items.map((token) => (
            <li key={token.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{token.name}</span>
                  {token.revokedAt ? (
                    <Badge variant="secondary">เพิกถอนแล้ว</Badge>
                  ) : (
                    <Badge variant="outline">ใช้งานได้</Badge>
                  )}
                </div>
                <code className="text-xs text-muted-foreground">{token.prefix}…</code>
                <p className="text-xs text-muted-foreground">
                  ออกเมื่อ {when(token.createdAt)}
                  {token.createdByName ? ` โดย ${token.createdByName}` : ""} · ใช้ล่าสุด{" "}
                  {when(token.lastUsedAt)}
                  {token.revokedAt ? ` · เพิกถอนเมื่อ ${when(token.revokedAt)}` : ""}
                </p>
              </div>
              {!token.revokedAt && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDialog({ kind: "revoke", token })}
                >
                  <Ban data-icon="inline-start" aria-hidden />
                  เพิกถอน
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === "issue" && (
        <FormDialog
          title="ออก token ใหม่"
          icon={KeyRound}
          description="ตั้งชื่อให้รู้ว่า token นี้ใช้กับบอทตัวไหน เช่น esport bot"
          submitLabel="ออก token"
          submitIcon={KeyRound}
          pending={issue.isPending}
          onClose={() => setDialog(null)}
          onSubmit={submitIssue}
        >
          <TextField
            id="bot-token-name"
            label="ชื่อ"
            icon={Bot}
            value={name}
            onChange={setName}
            error={nameError}
            maxLength={60}
            autoFocus
          />
        </FormDialog>
      )}

      {dialog?.kind === "issued" && (
        <AlertDialog open onOpenChange={(open) => !open && setDialog(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>token ของ {dialog.token.name}</AlertDialogTitle>
              <AlertDialogDescription className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
                คัดลอกเก็บไว้ตอนนี้ ระบบจะไม่แสดง token นี้อีก ถ้าทำหายให้ออกใหม่แล้วเพิกถอนอันเดิม
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex items-center gap-2 rounded-lg border bg-muted p-3">
              <code className="min-w-0 flex-1 break-all text-sm" data-testid="issued-token">
                {dialog.token.token}
              </code>
              <CopyButton text={dialog.token.token} label=" token" />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>คัดลอกแล้ว ปิด</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {dialog?.kind === "revoke" && (
        <AlertDialog open onOpenChange={(open) => !open && setDialog(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>เพิกถอน {dialog.token.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                บอทที่ใช้ token นี้จะเรียก API ไม่ได้ทันที และนำกลับมาใช้อีกไม่ได้
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
              <LoadingButton
                variant="destructive"
                loading={revoke.isPending}
                onClick={() => revoke.mutate(dialog.token.id)}
              >
                เพิกถอน
              </LoadingButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
