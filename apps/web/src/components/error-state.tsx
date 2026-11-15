import { buttonVariants } from "@it3k/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@it3k/ui/components/empty";
import { cn } from "@it3k/ui/lib/utils";
import {
  ChevronRight,
  CloudOff,
  Copy,
  FileQuestion,
  House,
  LockKeyhole,
  LogIn,
  type LucideIcon,
  RefreshCw,
  RotateCw,
  ServerCrash,
  Sparkles,
  TriangleAlert,
  UserRoundCog,
  WifiOff,
  Hourglass,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { type ErrorInfo, type ErrorKind, bodyUnder, describeError } from "@/lib/errors";

import { LoadingButton } from "./loading-button";

export const ERROR_ICONS: Record<ErrorKind, LucideIcon> = {
  offline: WifiOff,
  network: CloudOff,
  outdated: Sparkles,
  signedOut: LogIn,
  accountChanged: UserRoundCog,
  forbidden: LockKeyhole,
  notFound: FileQuestion,
  stale: RefreshCw,
  invalid: TriangleAlert,
  rateLimited: Hourglass,
  server: ServerCrash,
  unknown: TriangleAlert,
};

/** Runs `retry` and reports whether it is still running, for a spinner. */
export function useRetry(retry?: () => unknown) {
  const [retrying, setRetrying] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(async () => {
    if (!retry) return;
    setRetrying(true);
    try {
      await retry();
    } finally {
      if (mounted.current) setRetrying(false);
    }
  }, [retry]);
  return [retrying, run] as const;
}

/** Retries by itself when the browser comes back online. */
export function useRetryWhenOnline(info: ErrorInfo, retry: () => unknown) {
  useEffect(() => {
    if (!info.retryable) return;
    const onOnline = () => void retry();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [info.retryable, retry]);
}

/** The raw error, folded away, for people reporting a problem to the team. */
export function ErrorDetail({ detail, className }: { detail?: string; className?: string }) {
  if (!detail) return null;
  return (
    <details className={cn("group w-full max-w-sm text-left text-xs", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-1 text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
        รายละเอียดทางเทคนิค
      </summary>
      <div className="mt-2 flex items-start gap-2 rounded-lg bg-muted p-2">
        <code className="min-w-0 flex-1 font-mono break-all whitespace-pre-wrap text-muted-foreground">
          {detail}
        </code>
        <button
          type="button"
          aria-label="คัดลอกรายละเอียด"
          className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
          onClick={() =>
            void navigator.clipboard
              .writeText(detail)
              .then(() => toast.success("คัดลอกแล้ว"))
              .catch(() => toast.error("คัดลอกไม่สำเร็จ"))
          }
        >
          <Copy className="size-3.5" aria-hidden />
        </button>
      </div>
    </details>
  );
}

/** The sign-in page, set to come back here afterwards. */
export function signInHref() {
  if (typeof window === "undefined") return "/login";
  const { pathname, search, hash } = window.location;
  return `/login?to=${encodeURIComponent(pathname + search + hash)}`;
}

/**
 * Shown in place of data that failed to load: what happened in Thai, and the
 * one next step that can fix it (retry, reload, sign in, or go home).
 */
export function ErrorState({
  error,
  onRetry,
  title,
  size = "default",
  className,
}: {
  error: unknown;
  /** Usually a query's `refetch`. The button shows a spinner until it settles. */
  onRetry?: () => unknown;
  /** What failed, e.g. "โหลดรายชื่อไม่สำเร็จ"; defaults to the kind of failure. */
  title?: string;
  size?: "sm" | "default";
  className?: string;
}) {
  const info = describeError(error);
  const Icon = ERROR_ICONS[info.kind];
  const [retrying, retry] = useRetry(onRetry);
  useRetryWhenOnline(info, retry);

  const action =
    info.action === "reload" ? (
      <LoadingButton
        loading={false}
        icon={RotateCw}
        size={size === "sm" ? "sm" : "default"}
        onClick={() => window.location.reload()}
      >
        โหลดหน้าใหม่
      </LoadingButton>
    ) : info.action === "signIn" ? (
      // Plain links, so this also works outside a router (in dialogs and tests).
      <a href={signInHref()} className={buttonVariants({ size: size === "sm" ? "sm" : "default" })}>
        <LogIn data-icon="inline-start" aria-hidden />
        เข้าสู่ระบบอีกครั้ง
      </a>
    ) : onRetry && info.retryable ? (
      <LoadingButton
        loading={retrying}
        icon={RefreshCw}
        variant="outline"
        size={size === "sm" ? "sm" : "default"}
        onClick={() => void retry()}
      >
        {retrying ? "กำลังลองใหม่…" : "ลองอีกครั้ง"}
      </LoadingButton>
    ) : info.action === "home" ? (
      <a href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
        <House data-icon="inline-start" aria-hidden />
        กลับหน้าแรก
      </a>
    ) : null;

  return (
    <Empty
      role="alert"
      data-error-kind={info.kind}
      className={cn(
        "border border-dashed bg-muted/30",
        size === "sm" ? "gap-3 p-6" : "p-8 md:p-12",
        className,
      )}
    >
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className={cn(
            info.kind === "server" || info.kind === "unknown" || info.kind === "invalid"
              ? "bg-destructive/10 text-destructive"
              : "bg-muted text-muted-foreground",
          )}
        >
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle className={size === "sm" ? "text-base" : undefined}>
          {title ?? info.title}
        </EmptyTitle>
        <EmptyDescription>{bodyUnder(info, title ?? info.title)}</EmptyDescription>
      </EmptyHeader>
      {(action || info.detail) && (
        <EmptyContent className="gap-3">
          {action}
          <ErrorDetail detail={info.detail} className="[&>summary]:justify-center" />
        </EmptyContent>
      )}
    </Empty>
  );
}
