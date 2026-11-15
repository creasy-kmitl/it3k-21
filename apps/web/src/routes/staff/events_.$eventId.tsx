import { INSTITUTIONS, type Institution } from "@it3k/db/profile";
import { Avatar, AvatarFallback, AvatarImage } from "@it3k/ui/components/avatar";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { Input } from "@it3k/ui/components/input";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  CalendarCheck,
  Download,
  LogIn,
  MapPin,
  ScanBarcode,
  Search,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { SegmentedControl } from "@/components/segmented-control";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import { csvBlob } from "@/lib/csv";
import type { Participant } from "@/lib/events";
import { downloadBlob } from "@/lib/qr-export";
import { eventTime } from "./events";

export const Route = createFileRoute("/staff/events_/$eventId")({
  head: () => ({ meta: [{ title: "ผู้เข้าร่วมกิจกรรม · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { eventId } = Route.useParams();
  return <EventParticipantsPage eventId={eventId} />;
}

const institutionShort = (id: Institution | null) =>
  id ? (INSTITUTIONS.find((item) => item.id === id)?.short ?? id) : "—";

export const fullName = (person: Pick<Participant, "prefix" | "firstName" | "lastName" | "name">) =>
  person.firstName ? `${person.prefix}${person.firstName} ${person.lastName}` : person.name;

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
      item.checkin ? formatBangkok(Date.parse(item.checkin.at), "dateTime") : "",
      item.checkin?.method ?? "",
      item.checkin ? (item.checkin.forced ? "yes" : "no") : "",
    ]),
  ]);
}

type Show = "all" | "in" | "out";

/** Who an event expects and who has checked in, with manual check-in and export. */
export function EventParticipantsPage({ eventId }: { eventId: string }) {
  const { events: api } = useApis();
  const queryClient = useQueryClient();
  const event = useQuery({ queryKey: ["events", eventId], queryFn: () => api.get(eventId) });
  const participants = useQuery({
    queryKey: ["events", eventId, "participants"],
    queryFn: () => api.participants(eventId),
  });
  const [show, setShow] = useState<Show>("all");
  const [search, setSearch] = useState("");

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["events", eventId, "participants"] });
  const checkIn = useMutation({
    mutationFn: (userId: string) => api.checkIn(eventId, { userId, method: "manual" }),
    onSuccess: (outcome) => {
      if (outcome.code === "checked-in") toast.success(`เช็คอิน ${fullName(outcome.person)} แล้ว`);
      else toast.error(outcome.message);
    },
    onError: (error) => toast.error(error.message),
    onSettled: refresh,
  });
  const undo = useMutation({
    mutationFn: (userId: string) => api.undoCheckIn(eventId, userId),
    onSuccess: () => toast.success("ยกเลิกการเช็คอินแล้ว"),
    onError: (error) => toast.error(error.message),
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

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        render={<Link to="/staff/events" />}
        nativeButton={false}
      >
        <ArrowLeft data-icon="inline-start" aria-hidden /> กิจกรรมทั้งหมด
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          icon={CalendarCheck}
          title={event.data?.name ?? "กิจกรรม"}
          description={
            event.data ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{eventTime(event.data)}</span>
                {event.data.venue && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-4" aria-hidden />
                    {event.data.venue.name}
                  </span>
                )}
              </span>
            ) : undefined
          }
        />
        <div className="flex flex-wrap gap-2">
          {participants.data?.canExport && (
            <Button
              variant="outline"
              onClick={() =>
                downloadBlob(participantsCsv(items), `it3k-event-${eventId.slice(0, 8)}.csv`)
              }
            >
              <Download data-icon="inline-start" aria-hidden />
              ส่งออก CSV
            </Button>
          )}
          {participants.data?.canCheckIn && (
            <Button
              render={<Link to="/kiosk/$eventId" params={{ eventId }} />}
              nativeButton={false}
            >
              <ScanBarcode data-icon="inline-start" aria-hidden />
              เปิด Kiosk
            </Button>
          )}
        </div>
      </div>

      {participants.isPending ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : participants.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-destructive">
          <p>โหลดรายชื่อไม่สำเร็จ: {participants.error.message}</p>
          <Button variant="outline" size="sm" onClick={() => void participants.refetch()}>
            ลองอีกครั้ง
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            เช็คอินแล้ว {checkedIn} จาก {items.length} คน
          </p>
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
                type="search"
                aria-label="ค้นหาผู้เข้าร่วม"
                placeholder="ค้นหาชื่อ ชื่อเล่น หรือรหัสนักศึกษา"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          {visible.length === 0 ? (
            <p className="text-muted-foreground">
              {items.length === 0 ? "ยังไม่มีผู้เข้าร่วม" : "ไม่พบผู้เข้าร่วมที่ตรงกับตัวกรอง"}
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-2xl border">
              {visible.map((item) => (
                <li key={item.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
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
                      {!item.expected && <Badge variant="destructive">ไม่อยู่ในรายชื่อ</Badge>}
                    </span>
                  </div>
                  {item.checkin ? (
                    <span className="flex items-center gap-2 text-sm">
                      <Badge>
                        เช็คอิน {formatBangkok(Date.parse(item.checkin.at), "time")}
                        {item.checkin.method === "manual" ? " · มือ" : ""}
                      </Badge>
                      {participants.data.canUndo && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`ยกเลิกการเช็คอิน ${item.name}`}
                          disabled={undo.isPending}
                          onClick={() => undo.mutate(item.userId)}
                        >
                          <Undo2 />
                        </Button>
                      )}
                    </span>
                  ) : (
                    participants.data.canCheckIn && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`เช็คอิน ${item.name}`}
                        disabled={checkIn.isPending}
                        onClick={() => checkIn.mutate(item.userId)}
                      >
                        <LogIn data-icon="inline-start" aria-hidden /> เช็คอิน
                      </Button>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
