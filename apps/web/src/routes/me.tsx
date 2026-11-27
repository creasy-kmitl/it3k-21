import { INSTITUTIONS } from "@it3k/db/profile";
import { Button } from "@it3k/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@it3k/ui/components/card";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  ContactRound,
  Copy,
  Crown,
  IdCard,
  Mail,
  Pencil,
  Phone,
  Pill,
  ScanBarcode,
  Smile,
  Stethoscope,
  Ticket,
  Trophy,
  UserRound,
  UserRoundPlus,
  UtensilsCrossed,
  WheatOff,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ParticipantShell } from "@/components/participant-shell";
import { RoleBadge } from "@/components/role-badge";
import { RegistrationRow, RegistrationRows } from "@/components/sport-registration-row";
import { Barcode, UserBarcode } from "@/components/user-barcode";
import { useApis } from "@/lib/api-context";
import { publicFileUrl } from "@/lib/files";
import { requireParticipantSession } from "@/lib/participant-auth";
import { ErrorState } from "@/components/error-state";

export const Route = createFileRoute("/me")({
  ssr: false,
  beforeLoad: async ({ context, location }) => ({
    session: await requireParticipantSession(context.queryClient, location.href),
  }),
  head: () => ({
    meta: [{ title: "โปรไฟล์ของฉัน · IT3Kings" }, { name: "robots", content: "noindex" }],
  }),
  component: MePage,
});

function MePage() {
  const { session } = Route.useRouteContext();
  const { profile } = useApis();
  const me = useQuery({
    queryKey: ["profile", "me", session.user.id],
    queryFn: () => profile.me(session.user.id),
  });
  if (me.isPending)
    return (
      <ParticipantShell userId={session.user.id} role={session.user.role ?? "guest"}>
        <Skeleton className="h-96 w-full" />
      </ParticipantShell>
    );
  if (me.isError)
    return (
      <ParticipantShell userId={session.user.id} role={session.user.role ?? "guest"}>
        <ErrorState error={me.error} onRetry={me.refetch} title="โหลดโปรไฟล์ไม่สำเร็จ" />
      </ParticipantShell>
    );
  const { account, profile: values } = me.data;
  // The account's institution wins over the profile's (staff may have changed it).
  const institution = INSTITUTIONS.find(
    (item) => item.id === (me.data.institution ?? values?.institution),
  );
  const details = values
    ? [
        { label: "คำนำหน้า", value: values.prefix, icon: IdCard },
        { label: "ชื่อ", value: values.firstName, icon: UserRound },
        { label: "นามสกุล", value: values.lastName, icon: ContactRound },
        { label: "ชื่อเล่น", value: values.nickname, icon: Smile },
        { label: "เบอร์โทรศัพท์", value: values.phone, icon: Phone },
        { label: "อีเมล", value: account.email, icon: Mail },
        {
          label: "สร้างบัญชีเมื่อ",
          value: new Date(account.createdAt).toLocaleDateString("th-TH"),
          icon: CalendarDays,
        },
        { label: "โรคประจำตัว", value: values.medicalConditions, icon: Stethoscope },
        { label: "ประวัติการแพ้ยา", value: values.drugAllergies, icon: Pill },
        { label: "อาหารที่แพ้", value: values.foodAllergies, icon: WheatOff },
        { label: "ข้อจำกัดด้านอาหาร", value: values.dietaryRestrictions, icon: UtensilsCrossed },
        { label: "รหัสฝ่าย", value: account.departmentId, icon: Building2 },
        {
          label: "ตำแหน่งทีมงาน",
          value:
            account.seatRole === "head"
              ? "หัวหน้าฝ่าย"
              : account.seatRole === "vicehead"
                ? "รองหัวหน้าฝ่าย"
                : null,
          icon: Crown,
        },
      ]
    : [];
  return (
    <ParticipantShell userId={session.user.id} role={account.role}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PageHeader icon={UserRound} title="โปรไฟล์ของฉัน" description="ข้อมูลการลงทะเบียน IT3Kings" />
          <Button variant="outline" render={<Link to="/signup" />} nativeButton={false}>
            {values ? (
              <Pencil data-icon="inline-start" aria-hidden />
            ) : (
              <UserRoundPlus data-icon="inline-start" aria-hidden />
            )}
            {values ? "แก้ไขข้อมูล" : "ลงทะเบียนผู้เข้าร่วม"}
          </Button>
        </div>
        {!values ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 [&_svg]:size-5 [&_svg]:shrink-0">
                <UserRoundPlus className="text-primary" aria-hidden />
                ยังไม่ได้ลงทะเบียนผู้เข้าร่วม
              </CardTitle>
              <CardDescription>กรอกข้อมูลให้ครบเพื่อสร้างโปรไฟล์ของคุณ</CardDescription>
            </CardHeader>
            <CardContent>
              <Button render={<Link to="/signup" />} nativeButton={false}>
                กรอกข้อมูลต่อ
                <ArrowRight data-icon="inline-end" aria-hidden />
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[20rem_1fr]">
            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader>
                  <img
                    src={publicFileUrl(values.photoFileId)}
                    alt={`รูปของ ${values.firstName}`}
                    className="aspect-square w-full rounded-2xl object-cover"
                  />
                  <CardTitle className="flex items-center gap-2 [&_svg]:size-5 [&_svg]:shrink-0">
                    <UserRound className="text-primary" aria-hidden />
                    {values.prefix} {values.firstName} {values.lastName}
                  </CardTitle>
                  <CardDescription className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
                    <Smile aria-hidden />
                    {values.nickname}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-wrap gap-2">
                    {account.roles.map((role) => (
                      <RoleBadge key={role} kind={role} />
                    ))}
                  </div>
                  {institution && (
                    <div className="flex items-center gap-3">
                      <img
                        src={institution.logo}
                        alt=""
                        className="size-10 shrink-0 object-contain"
                      />
                      <p className="text-sm">{institution.name}</p>
                    </div>
                  )}
                  <div className="flex flex-col gap-2 border-t pt-4">
                    <UserBarcode id={account.id} />
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {account.id}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="คัดลอกรหัสผู้ใช้"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(account.id)
                            .then(() => toast.success("คัดลอกรหัสแล้ว"))
                            .catch(() => toast.error("คัดลอกไม่สำเร็จ"))
                        }
                      >
                        <Copy aria-hidden />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <SportCheckinCard />
            </div>
            <div className="flex flex-col gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 [&_svg]:size-5 [&_svg]:shrink-0">
                    <ClipboardList className="text-primary" aria-hidden />
                    ข้อมูลการลงทะเบียน
                  </CardTitle>
                  <CardDescription>
                    ลงทะเบียนเมื่อ{" "}
                    {me.data.submittedAt
                      ? new Date(me.data.submittedAt).toLocaleDateString("th-TH")
                      : "—"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-6 sm:grid-cols-2">
                    {details.map(({ label, value, icon: Icon }) => (
                      <div key={label} className="flex flex-col gap-1">
                        <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Icon className="size-4 shrink-0" aria-hidden />
                          {label}
                        </dt>
                        <dd className="break-words whitespace-pre-wrap">{value || "ไม่ได้ระบุ"}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
              <TicketsCard />
              <AthleteCard />
            </div>
          </div>
        )}
      </div>
    </ParticipantShell>
  );
}

/**
 * The six digits an athlete shows at a match's kiosk, as a barcode short
 * enough for any camera. Hidden until the account has registered for a sport.
 */
export function SportCheckinCard() {
  const { registrations } = useApis();
  const code = useQuery({
    queryKey: ["registrations", "me", "checkin-code"],
    queryFn: () => registrations.checkinCode(),
  });
  const value = code.data?.code;
  if (!value) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 [&_svg]:size-5 [&_svg]:shrink-0">
          <ScanBarcode className="text-primary" aria-hidden />
          รหัสเช็คอินกีฬา
        </CardTitle>
        <CardDescription>ใช้รายงานตัวก่อนแข่งที่ kiosk ของแมตช์</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-2">
        <Barcode value={value} label={`บาร์โค้ดรหัสเช็คอินกีฬา ${value}`} height={72} width={3} />
        <p className="font-mono text-3xl font-semibold tracking-[0.3em] tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

/** The way to /me/tickets, where an event's QR ticket is shown at check-in. */
function TicketsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 [&_svg]:size-5 [&_svg]:shrink-0">
          <Ticket className="text-primary" aria-hidden />
          ตั๋วกิจกรรม
        </CardTitle>
        <CardDescription>รับตั๋วกิจกรรม แล้วแสดง QR ที่จุดเช็คอิน</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button render={<Link to="/me/tickets" />} nativeButton={false}>
          <Ticket data-icon="inline-start" aria-hidden />
          ตั๋วของฉัน
        </Button>
        <Button variant="outline" render={<Link to="/events" />} nativeButton={false}>
          <CalendarRange data-icon="inline-start" aria-hidden />
          ดูกิจกรรม
        </Button>
      </CardContent>
    </Card>
  );
}

/** The athlete's registrations at a glance, with the way to /sports. */
function AthleteCard() {
  const { registrations } = useApis();
  const mine = useQuery({ queryKey: ["registrations", "me"], queryFn: () => registrations.me() });
  const items = mine.data?.registrations ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 [&_svg]:size-5 [&_svg]:shrink-0">
          <Trophy className="text-primary" aria-hidden />
          การสมัครกีฬา
        </CardTitle>
        <CardDescription>
          {mine.isPending
            ? "กำลังโหลด"
            : mine.isError
              ? "โหลดการสมัครไม่สำเร็จ"
              : items.length === 0
                ? "ยังไม่ได้สมัครกีฬา สมัครได้หลายประเภท"
                : `สมัครไว้ ${items.length} ประเภท`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {items.length > 0 && (
          <RegistrationRows>
            {items.map((item) => (
              <RegistrationRow key={item.id} registration={item} />
            ))}
          </RegistrationRows>
        )}
        <Button className="self-start" render={<Link to="/sports" />} nativeButton={false}>
          <Trophy data-icon="inline-start" aria-hidden />
          {items.length === 0 ? "สมัครเป็นนักกีฬา" : "จัดการการสมัคร"}
        </Button>
      </CardContent>
    </Card>
  );
}
