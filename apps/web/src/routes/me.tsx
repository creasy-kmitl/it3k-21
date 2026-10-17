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
  Barcode,
  Building2,
  CalendarDays,
  ClipboardList,
  ContactRound,
  Copy,
  Crown,
  IdCard,
  Mail,
  Pencil,
  Phone,
  Pill,
  RefreshCw,
  Smile,
  Stethoscope,
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
import { UserBarcode } from "@/components/user-barcode";
import { useApis } from "@/lib/api-context";
import { publicFileUrl } from "@/lib/files";
import { requireParticipantSession } from "@/lib/participant-auth";

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
        <div role="alert">
          <p>{me.error.message}</p>
          <Button onClick={() => void me.refetch()}>
            <RefreshCw data-icon="inline-start" aria-hidden />
            ลองอีกครั้ง
          </Button>
        </div>
      </ParticipantShell>
    );
  const { account, profile: values } = me.data;
  const institution = INSTITUTIONS.find((item) => item.id === values?.institution);
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
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 [&_svg]:size-5 [&_svg]:shrink-0">
                    <Barcode className="text-primary" aria-hidden />
                    รหัสผู้ใช้
                  </CardTitle>
                  <CardDescription>user_id</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <code className="break-all text-sm">{account.id}</code>
                  <UserBarcode id={account.id} />
                  <Button
                    variant="outline"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(account.id)
                        .then(() => toast.success("คัดลอกรหัสแล้ว"))
                        .catch(() => toast.error("คัดลอกไม่สำเร็จ"))
                    }
                  >
                    <Copy data-icon="inline-start" aria-hidden />
                    คัดลอกรหัส
                  </Button>
                </CardContent>
              </Card>
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
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 [&_svg]:size-5 [&_svg]:shrink-0">
                    <Trophy className="text-primary" aria-hidden />
                    สมัครเป็นนักกีฬา
                  </CardTitle>
                  <CardDescription>ระบบลงทะเบียนนักกีฬายังไม่พร้อมใช้งาน</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button disabled aria-describedby="athlete-unavailable">
                    <Trophy data-icon="inline-start" aria-hidden />
                    สมัครเป็นนักกีฬา
                  </Button>
                  <p id="athlete-unavailable" className="mt-3 text-sm text-muted-foreground">
                    ระบบลงทะเบียนนักกีฬายังไม่พร้อมใช้งาน
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </ParticipantShell>
  );
}
