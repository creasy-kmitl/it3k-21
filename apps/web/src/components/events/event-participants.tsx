import { INSTITUTIONS, type Institution } from "@it3k/db/profile";
import { Avatar, AvatarFallback, AvatarImage } from "@it3k/ui/components/avatar";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@it3k/ui/components/dropdown-menu";
import { Input } from "@it3k/ui/components/input";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Download,
  LogIn,
  MonitorSmartphone,
  MoreHorizontal,
  ScanBarcode,
  Search,
  Undo2,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { ScanSheet } from "@/components/checkin/scan-sheet";
import { ErrorState } from "@/components/error-state";
import { LoadingButton } from "@/components/loading-button";
import { SegmentedControl } from "@/components/segmented-control";
import { ShortcutHint } from "@/components/shortcut-hint";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import { csvBlob } from "@/lib/csv";
import { toastError } from "@/lib/errors";
import type { EventDetail, Participant } from "@/lib/events";
import { type Decoder, createDecoder } from "@/lib/kiosk";
import { downloadBlob } from "@/lib/qr-export";

export const SEARCH_HOTKEY = "Mod+K" as const;
export const SCAN_HOTKEY = "S" as const;

const institutionShort = (id: Institution | null) =>
  id ? (INSTITUTIONS.find((item) => item.id === id)?.short ?? id) : "—";

export const fullName = (person: Pick<Participant, "prefix" | "firstName" | "lastName" | "name">) =>
  person.firstName ? `${person.prefix}${person.firstName} ${person.lastName}` : person.name;

/** "เช็คอิน 1/2 ใบ" for someone with several tickets; null for the usual one. */
export function ticketProgress(item: Pick<Participant, "tickets" | "checkins">) {
  if (item.tickets.length < 2) return null;
  const used = item.tickets.filter((ticket) => ticket.checkin).length;
  return `เช็คอิน ${used}/${item.tickets.length} ใบ`;
}

/** The participant list as a spreadsheet, one row per person. */
export function participantsCsv(items: Participant[]) {
  return csvBlob([
    [
      "user_id",
      "student_id",
      "prefix",
      "first_name",
      "last_name",
      "nickname",
      "institution",
      "divisions",
      "on_list",
      "has_ticket",
      "ticket_types",
      "checked_in",
      "checked_in_at",
      "method",
      "forced",
    ],
    ...items.map((item) => [
      item.userId,
      item.studentId,
      item.prefix,
      item.firstName || item.name,
      item.lastName,
      item.nickname,
      institutionShort(item.institution),
      item.divisions.map((division) => division.name).join(" / "),
      item.expected ? "yes" : "no",
      item.hasTicket ? "yes" : "no",
      item.tickets.map((ticket) => ticket.typeName).join(" / "),
      String(item.checkins.length),
      item.checkin ? formatBangkok(Date.parse(item.checkin.at), "dateTime") : "",
      item.checkin?.method ?? "",
      item.checkin ? (item.checkin.forced ? "yes" : "no") : "",
    ]),
  ]);
}

/** Whether someone has a ticket left to check in, or none at all (a forced check-in). */
const canCheckInAgain = (item: Participant) =>
  item.tickets.length === 0 ? !item.checkin : item.tickets.some((ticket) => !ticket.checkin);

type Show = "all" | "in" | "out";

/** Who an event expects and who has checked in, with manual check-in and export. */
export function EventParticipants({
  event,
  eventKey,
  decoderFactory = createDecoder,
}: {
  event: EventDetail;
  /** The id or slug in the page's URL, which the queries are keyed by. */
  eventKey: string;
  decoderFactory?: () => Promise<Decoder>;
}) {
  const { events: api } = useApis();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const id = event.id;
  const participants = useQuery({
    queryKey: ["events", eventKey, "participants"],
    queryFn: () => api.participants(id),
  });
  const [show, setShow] = useState<Show>("all");
  const [search, setSearch] = useState("");
  const [scanning, setScanning] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const canCheckIn = !!participants.data?.canCheckIn;

  useHotkey(SEARCH_HOTKEY, () => searchRef.current?.focus(), { ignoreInputs: false });
  useHotkey(SCAN_HOTKEY, () => setScanning(true), { enabled: canCheckIn && !scanning });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["events", eventKey, "participants"] });
  const checkIn = useMutation({
    mutationFn: (vars: { userId: string; force?: boolean }) =>
      api.checkIn(id, { ...vars, method: "manual" }),
    onSuccess: (outcome, vars) => {
      if (outcome.code === "checked-in") {
        const which = outcome.ticket && outcome.ticket.total > 1
          ? ` (ใบที่ ${outcome.ticket.index}/${outcome.ticket.total})`
          : "";
        toast.success(`เช็คอิน ${fullName(outcome.person)} แล้ว${which}`);
      } else if ("canForce" in outcome && outcome.canForce) {
        toast.error(outcome.message, {
          action: {
            label: "บังคับเช็คอิน",
            onClick: () => checkIn.mutate({ userId: vars.userId, force: true }),
          },
        });
      } else toast.error(outcome.message);
    },
    onError: (error) => toastError(error, "เช็คอินไม่สำเร็จ"),
    onSettled: refresh,
  });
  const undo = useMutation({
    mutationFn: (checkinId: string) => api.undoCheckIn(id, checkinId),
    onSuccess: () => toast.success("ยกเลิกการเช็คอินแล้ว"),
    onError: (error) => toastError(error, "ยกเลิกการเช็คอินไม่สำเร็จ"),
    onSettled: refresh,
  });

  const items = participants.data?.items ?? [];
  const checkedIn = items.filter((item) => item.checkin).length;
  const needle = search.trim().toLowerCase();
  const visible = items.filter(
    (item) =>
      (show === "all" || (show === "in") === !!item.checkin) &&
      (!needle ||
        [fullName(item), item.name, item.nickname, item.studentId ?? "", item.userId].some((text) =>
          text.toLowerCase().includes(needle),
        )),
  );
  const exportCsv = () =>
    downloadBlob(participantsCsv(items), `it3k-event-${event.slug ?? id.slice(0, 8)}.csv`);
  const kioskLink = <Link to="/kiosk/$eventId" params={{ eventId: event.slug ?? id }} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm text-muted-foreground" aria-live="polite">
          {participants.data ? `เช็คอินแล้ว ${checkedIn} จาก ${items.length} คน` : ""}
        </p>
        {/* Phones keep the scan button and fold the rest into a menu. */}
        {(participants.data?.canExport || canCheckIn) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="icon" className="size-11 sm:hidden" aria-label="เพิ่มเติม" />
              }
            >
              <MoreHorizontal aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {participants.data?.canExport && (
                <DropdownMenuItem onClick={exportCsv}>
                  <Download aria-hidden /> ส่งออก CSV
                </DropdownMenuItem>
              )}
              {canCheckIn && (
                <DropdownMenuItem
                  onClick={() =>
                    navigate({ to: "/kiosk/$eventId", params: { eventId: event.slug ?? id } })
                  }
                >
                  <MonitorSmartphone aria-hidden /> เปิด Kiosk
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {participants.data?.canExport && (
          <Button variant="outline" className="hidden sm:inline-flex" onClick={exportCsv}>
            <Download data-icon="inline-start" aria-hidden />
            ส่งออก CSV
          </Button>
        )}
        {canCheckIn && (
          <>
            {/* Two ways to scan: a drawer here, or the full-screen kiosk for a desk. */}
            <Button
              variant="outline"
              className="hidden sm:inline-flex"
              render={kioskLink}
              nativeButton={false}
            >
              <MonitorSmartphone data-icon="inline-start" aria-hidden />
              เปิด Kiosk
            </Button>
            <Button className="h-11 sm:h-9" onClick={() => setScanning(true)}>
              <ScanBarcode data-icon="inline-start" aria-hidden />
              สแกนเช็คอิน
              <ShortcutHint hotkey={SCAN_HOTKEY} />
            </Button>
          </>
        )}
      </div>

      {canCheckIn && (
        <ScanSheet
          open={scanning}
          onOpenChange={setScanning}
          eventKey={eventKey}
          id={id}
          eventName={event.name}
          counts={{ checkedIn, total: items.length }}
          decoderFactory={decoderFactory}
        />
      )}

      {participants.isPending ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : participants.isError ? (
        <ErrorState
          error={participants.error}
          onRetry={participants.refetch}
          title="โหลดรายชื่อไม่สำเร็จ"
        />
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SegmentedControl<Show>
              label="แสดง"
              value={show}
              onChange={setShow}
              segments={[
                { value: "all", label: "ทั้งหมด" },
                { value: "in", label: "เช็คอินแล้ว" },
                { value: "out", label: "ยังไม่เช็คอิน" },
              ]}
            />
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                ref={searchRef}
                type="search"
                aria-label="ค้นหาผู้เข้าร่วม"
                placeholder="ค้นหาชื่อ ชื่อเล่น หรือรหัสนักศึกษา"
                className="h-11 pr-14 pl-9 sm:h-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <ShortcutHint
                hotkey={SEARCH_HOTKEY}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
              />
            </div>
          </div>
          {visible.length === 0 ? (
            <p className="text-muted-foreground">
              {items.length === 0 ? "ยังไม่มีผู้เข้าร่วม" : "ไม่พบผู้เข้าร่วมที่ตรงกับตัวกรอง"}
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-2xl border">
              {visible.map((item) => {
                const latest = item.checkins.at(-1);
                const progress = ticketProgress(item);
                return (
                  <li
                    key={item.userId}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
                  >
                    <Avatar>
                      <AvatarImage src={item.image ?? undefined} alt="" />
                      <AvatarFallback>{item.name.trim().slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate font-medium">
                        {fullName(item)}
                        {item.nickname && (
                          <span className="text-muted-foreground"> ({item.nickname})</span>
                        )}
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-md border px-1.5 py-0.5">
                          {institutionShort(item.institution)}
                        </span>
                        {item.studentId && <span>รหัส {item.studentId}</span>}
                        {item.divisions.length > 0 && (
                          <span>{item.divisions.map((d) => d.name).join(", ")}</span>
                        )}
                        {item.tickets.length > 0 && (
                          <span>{[...new Set(item.tickets.map((t) => t.typeName))].join(", ")}</span>
                        )}
                        {!item.expected && <Badge variant="destructive">ไม่อยู่ในรายชื่อ</Badge>}
                        {!item.hasTicket && !item.checkin && (
                          <Badge variant="outline">ยังไม่รับตั๋ว</Badge>
                        )}
                        {progress && <Badge variant="secondary">{progress}</Badge>}
                      </span>
                    </div>
                    <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                      {item.checkin && latest && (
                        <span className="flex items-center gap-1 text-sm">
                          <Badge>
                            เช็คอิน {formatBangkok(Date.parse(latest.at), "time")}
                            {latest.method === "manual" ? " · มือ" : ""}
                          </Badge>
                          {participants.data.canUndo && (
                            <LoadingButton
                              variant="ghost"
                              size="icon-sm"
                              className="size-11 sm:size-8"
                              aria-label={`ยกเลิกการเช็คอิน ${item.name}`}
                              icon={Undo2}
                              loading={undo.isPending && undo.variables === latest.id}
                              disabled={undo.isPending}
                              onClick={() => undo.mutate(latest.id)}
                            />
                          )}
                        </span>
                      )}
                      {canCheckIn && canCheckInAgain(item) && (
                        <LoadingButton
                          variant="outline"
                          size="sm"
                          className="h-11 flex-1 sm:h-8 sm:flex-none"
                          aria-label={`เช็คอิน ${item.name}`}
                          icon={LogIn}
                          loading={checkIn.isPending && checkIn.variables?.userId === item.userId}
                          disabled={checkIn.isPending}
                          onClick={() => checkIn.mutate({ userId: item.userId })}
                        >
                          เช็คอิน
                        </LoadingButton>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
