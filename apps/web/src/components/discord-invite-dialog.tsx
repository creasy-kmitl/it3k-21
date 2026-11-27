import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@it3k/ui/components/alert-dialog";
import { buttonVariants } from "@it3k/ui/components/button";
import { cn } from "@it3k/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { z } from "zod";

import { DiscordMark } from "@/components/discord-card";
import { useApis } from "@/lib/api-context";

/**
 * `?discord=linked`: where linking Discord sends people back to on success
 * (lib/registrations.ts linkDiscord). Pages that link Discord accept it in
 * their search and show {@link DiscordInviteDialog} while it is there.
 */
export const discordLinkedSearch = z.literal("linked").optional().catch(undefined);

/** Discord's brand colour, as on the Discord card. */
const BLURPLE = "bg-[#5865F2] text-white hover:bg-[#4752C4] hover:text-white";

/**
 * Invites someone who just linked Discord into the esports Discord server.
 * Shows nothing (and clears the flag at once) when no invite is configured or
 * the link did not stick.
 */
export function DiscordInviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile } = useApis();
  const discord = useQuery({
    queryKey: ["profile", "discord"],
    queryFn: () => profile.discord(),
    enabled: open,
  });
  const inviteUrl = discord.data?.linked ? discord.data.inviteUrl : null;
  const nothingToShow = open && (discord.isError || (discord.isSuccess && !inviteUrl));
  useEffect(() => {
    if (nothingToShow) onClose();
  }, [nothingToShow, onClose]);

  if (!open || !inviteUrl) return null;
  return (
    <AlertDialog open onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-[#5865F2] text-white sm:mx-0">
            <DiscordMark className="size-7" />
          </div>
          <AlertDialogTitle>เชื่อม Discord แล้ว เข้าเซิร์ฟเวอร์กันเลย</AlertDialogTitle>
          <AlertDialogDescription>
            เข้าเซิร์ฟเวอร์ Discord Esport ของงาน แล้วไปที่ช่อง ✅・verify กด รับยศ
            บอทจะให้ยศและตั้งชื่อในเซิร์ฟเวอร์ตามข้อมูลบนเว็บ
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ไว้ทีหลัง</AlertDialogCancel>
          <a
            href={inviteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants(), BLURPLE)}
            onClick={onClose}
          >
            <DiscordMark data-icon="inline-start" className="size-4" />
            เข้าเซิร์ฟเวอร์ Discord
          </a>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
