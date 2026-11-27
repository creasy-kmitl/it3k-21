import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@it3k/ui/components/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@it3k/ui/components/avatar";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { Card, CardContent } from "@it3k/ui/components/card";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Gamepad2,
  IdCard,
  type LucideIcon,
  MessagesSquare,
  ShieldCheck,
  Ticket,
  Unlink,
  Users,
} from "lucide-react";
import { type ComponentProps, useState } from "react";
import { toast } from "sonner";

import { LoadingButton } from "@/components/loading-button";
import { useApis } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import type { MyDiscord } from "@/lib/profile";

/** Discord's brand colour, for the mark and the connect button. */
const BLURPLE = "bg-[#5865F2] text-white";

/** The Discord mark, so the card reads as Discord at a glance. */
export function DiscordMark({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={cn("size-5", className)}
      {...props}
    >
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.009c.12.099.246.198.373.292a.077.077 0 0 1-.007.128 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029ZM8.02 15.331c-1.182 0-2.157-1.086-2.157-2.42 0-1.333.956-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.419 0 1.333-.956 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.086-2.157-2.42 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.419 0 1.333-.946 2.419-2.157 2.419Z" />
    </svg>
  );
}

type Perk = { icon: LucideIcon; label: string };

/** What linking brings, for who the account is in the esports Discord. */
export function perksFor(audience: MyDiscord["audience"]): Perk[] {
  const perks: Perk[] = [];
  if (audience.staff) {
    perks.push(
      { icon: ShieldCheck, label: "ยศ Staff" },
      { icon: MessagesSquare, label: "ห้องทีมงาน" },
      { icon: Ticket, label: "ดูแล ticket แจ้งปัญหา" },
    );
  }
  if (audience.athlete) {
    perks.push({ icon: Gamepad2, label: "ยศเกมที่ลงแข่ง" }, { icon: Users, label: "ห้องทีมของสถาบัน" });
  }
  perks.push({ icon: IdCard, label: "ชื่อในดิสตั้งให้อัตโนมัติ" });
  return perks;
}

/**
 * The account's link to the esports Discord, where the bot gives roles and a
 * server nickname by it. Shown only to those the Discord is for (its staff
 * and esports entrants; the API decides), and while Discord linking is on.
 */
export function DiscordCard() {
  const { profile, registrations } = useApis();
  const queryClient = useQueryClient();
  const discord = useQuery({ queryKey: ["profile", "discord"], queryFn: () => profile.discord() });
  const [confirming, setConfirming] = useState(false);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["profile", "discord"] }),
      queryClient.invalidateQueries({ queryKey: ["registrations"] }),
    ]);
  const link = useMutation({
    mutationFn: () => registrations.linkDiscord(`${window.location.origin}/me`),
    onError: (error) => toastError(error, "เชื่อม Discord ไม่สำเร็จ"),
  });
  const unlink = useMutation({
    mutationFn: (accountId: string) => registrations.unlinkDiscord(accountId),
    onSuccess: () => {
      toast.success("ยกเลิกการเชื่อม Discord แล้ว");
      setConfirming(false);
    },
    onError: (error) => toastError(error, "ยกเลิกการเชื่อม Discord ไม่สำเร็จ"),
    onSettled: refresh,
  });

  if (!discord.data) return null;
  const { enabled, linked, audience } = discord.data;
  if (!audience.staff && !audience.athlete) return null;
  if (!enabled && !linked) return null;

  const name = linked?.displayName || linked?.username;

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <div
            className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", BLURPLE)}
          >
            <DiscordMark className="size-6" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold leading-tight">Discord Esport</h2>
              {linked ? (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                  <BadgeCheck data-icon="inline-start" aria-hidden />
                  เชื่อมแล้ว
                </Badge>
              ) : (
                <Badge variant="outline">ยังไม่ได้เชื่อม</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {audience.staff
                ? "รับยศทีมงานและเข้าห้องทีมงานใน Discord Esport"
                : "รับยศเกมและเข้าห้องทีมของสถาบันคุณใน Discord Esport"}
            </p>
          </div>
        </div>

        {linked ? (
          <>
            <div className="flex items-center gap-3 rounded-xl border bg-muted/40 p-3">
              <Avatar className="size-10">
                {linked.avatarUrl ? <AvatarImage src={linked.avatarUrl} alt="" /> : null}
                <AvatarFallback className={BLURPLE}>
                  <DiscordMark className="size-5" />
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{name ?? "บัญชี Discord"}</span>
                {linked.username ? (
                  <span className="truncate text-sm text-muted-foreground">@{linked.username}</span>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                title="จะเปลี่ยนบัญชี ให้ยกเลิกแล้วเชื่อมใหม่"
                onClick={() => setConfirming(true)}
              >
                <Unlink data-icon="inline-start" aria-hidden />
                ยกเลิกการเชื่อม
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              ขั้นต่อไป: ในดิสคอร์ด ไปที่ช่อง{" "}
              <span className="font-medium text-foreground">✅・verify</span> แล้วกด{" "}
              <span className="font-medium text-foreground">รับยศ</span> ถ้าข้อมูลบนเว็บเปลี่ยนก็กดซ้ำได้
            </p>
          </>
        ) : (
          <>
            <ul className="flex flex-wrap gap-2" aria-label="สิ่งที่ได้เมื่อเชื่อม Discord">
              {perksFor(audience).map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="flex items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-sm"
                >
                  <Icon className="size-4 text-[#5865F2]" aria-hidden />
                  {label}
                </li>
              ))}
            </ul>
            <LoadingButton
              className={cn("self-start hover:bg-[#4752C4]", BLURPLE)}
              loading={link.isPending}
              onClick={() => link.mutate()}
            >
              {!link.isPending && <DiscordMark data-icon="inline-start" className="size-4" />}
              เชื่อม Discord
            </LoadingButton>
          </>
        )}
      </CardContent>

      {confirming && linked ? (
        <AlertDialog open onOpenChange={(open) => !open && setConfirming(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>ยกเลิกการเชื่อม Discord?</AlertDialogTitle>
              <AlertDialogDescription>
                {audience.athlete
                  ? "การสมัคร Esports ต้องใช้บัญชี Discord ที่เชื่อมไว้ และบอทจะให้ยศไม่ได้จนกว่าจะเชื่อมใหม่"
                  : "บอทจะให้ยศไม่ได้จนกว่าจะเชื่อมใหม่"}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>ไม่ใช่ตอนนี้</AlertDialogCancel>
              <LoadingButton
                variant="destructive"
                loading={unlink.isPending}
                onClick={() => unlink.mutate(linked.accountId)}
              >
                ยกเลิกการเชื่อม
              </LoadingButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </Card>
  );
}
