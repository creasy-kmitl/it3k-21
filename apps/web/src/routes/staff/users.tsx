import { createFileRoute } from "@tanstack/react-router";
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
import { Button } from "@it3k/ui/components/button";
import { Checkbox } from "@it3k/ui/components/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pencil, Search, UserCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { LeadershipApi, LeadershipDepartment } from "@/lib/leadership";
import { type Account, type Assignment, type UsersApi, useMe } from "@/lib/users";

import { DepartmentBadge, DepartmentLabel } from "@/components/department-icon";
import { PageHeader } from "@/components/page-header";
import { ROLE_BADGES, RoleBadge } from "@/components/role-badge";
import { useApis } from "@/lib/api-context";

export const Route = createFileRoute("/staff/users")({
  component: UsersPage,
});

type Status = Assignment["kind"];
const STATUSES: Status[] = ["guest", "athlete", "staff", "vicehead", "head"];
// Statuses that carry no department.
const UNAFFILIATED = new Set<Status>(["guest", "athlete"]);

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase();
}

function statusOf(account: Account): Status {
  if (account.seatRole) return account.seatRole;
  if (account.role === "athlete") return "athlete";
  return account.department ? "staff" : "guest";
}

/**
 * Accounts and what each one is: guest, athlete, staff of a department, or a head or
 * vicehead. The flags only decide what to show; the API enforces the rules.
 */
function UsersPage() {
  const { users: api, leadership: seats } = useApis();
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState<string>();
  const q = useDebouncedValue(search.trim(), 300);
  const filterKey = JSON.stringify([q, departmentId]);
  const [paging, setPaging] = useState({ filterKey, page: 1 });
  const page = paging.filterKey === filterKey ? paging.page : 1;
  const goTo = (next: number) => setPaging({ filterKey, page: next });
  const [editing, setEditing] = useState<Account | null>(null);

  const departments = useQuery({
    queryKey: ["leadership", "departments"],
    queryFn: () => seats.departments(),
    staleTime: 5 * 60_000,
  });
  const accounts = useQuery({
    queryKey: ["users", "list", { q, departmentId, page }],
    queryFn: () => api.list({ q: q || undefined, departmentId, page }),
    placeholderData: keepPreviousData,
  });

  const departmentItems = [
    { value: null, label: "ทุกฝ่าย" },
    ...(departments.data?.map((d) => ({
      value: d.id,
      label: <DepartmentLabel department={d} />,
    })) ?? []),
  ];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        icon={UserCog}
        title="ผู้ใช้"
        description="กำหนดว่าแต่ละบัญชีเป็น Guest, นักกีฬา, Staff หรือหัวหน้าฝ่ายใด"
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          items={departmentItems}
          value={departmentId ?? null}
          onValueChange={(value: string | null) => setDepartmentId(value ?? undefined)}
        >
          <SelectTrigger aria-label="ฝ่าย" className="sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {departmentItems.map((d) => (
              <SelectItem key={d.value ?? "all"} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="ค้นหาชื่อ"
            placeholder="ค้นหาชื่อ"
            className="pl-9"
            maxLength={64}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {accounts.isPending ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : accounts.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-destructive">
          <p>โหลดรายชื่อไม่สำเร็จ: {accounts.error.message}</p>
          <Button variant="outline" size="sm" onClick={() => void accounts.refetch()}>
            ลองอีกครั้ง
          </Button>
        </div>
      ) : accounts.data.items.length === 0 ? (
        <p className="text-muted-foreground">ไม่พบบัญชี</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-2xl border" aria-busy={accounts.isFetching}>
          {accounts.data.items.map((account) => (
            <li key={account.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar>
                <AvatarImage src={account.image ?? undefined} alt="" />
                <AvatarFallback>{initials(account.name)}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate font-medium">{account.name}</span>
                <AccountBadges account={account} />
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`แก้ไข ${account.name}`}
                disabled={!account.canEdit}
                onClick={() => setEditing(account)}
              >
                <Pencil />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {accounts.data && (page > 1 || accounts.data.hasMore) && (
        <nav className="flex items-center justify-between" aria-label="เลื่อนหน้า">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
            <ChevronLeft /> ก่อนหน้า
          </Button>
          <span className="text-sm text-muted-foreground">หน้า {page}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!accounts.data.hasMore}
            onClick={() => goTo(page + 1)}
          >
            ถัดไป <ChevronRight />
          </Button>
        </nav>
      )}

      {editing && (
        <EditAccountDialog
          // Remount per account so the fields start from its current values.
          key={editing.id}
          account={editing}
          departments={departments.data ?? []}
          canGrantAdmin={accounts.data?.canGrantAdmin ?? false}
          api={api}
          seats={seats}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AccountBadges({ account }: { account: Account }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {account.role === "admin" && <RoleBadge kind="admin" />}
      {account.seatRole ? (
        <RoleBadge kind={account.seatRole} department={account.department} />
      ) : (
        <>
          {account.role !== "admin" && <RoleBadge kind={account.role} />}
          {account.department && <DepartmentBadge department={account.department} />}
        </>
      )}
    </span>
  );
}

function EditAccountDialog({
  account,
  departments,
  canGrantAdmin,
  api,
  seats,
  onClose,
}: {
  account: Account;
  departments: LeadershipDepartment[];
  canGrantAdmin: boolean;
  api: UsersApi;
  seats: LeadershipApi;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: me } = useMe(api);
  const initialStatus = statusOf(account);
  const [status, setStatus] = useState<Status>(initialStatus);
  const [departmentId, setDepartmentId] = useState(account.department?.id ?? "");
  const [admin, setAdmin] = useState(account.role === "admin");
  const needsDepartment = !UNAFFILIATED.has(status);
  const seatRole = status === "head" || status === "vicehead" ? status : null;

  // Who holds the chosen seat now, so taking it over is never a surprise.
  const occupant = useQuery({
    queryKey: ["leadership", "list", { departmentId, page: 1 }],
    queryFn: () => seats.list({ departmentId, page: 1 }),
    enabled: seatRole !== null && departmentId !== "",
    select: (page) =>
      page.items.find((seat) => seat.role === seatRole && seat.userId !== account.id),
  });

  const save = useMutation({
    mutationFn: async () => {
      const assignmentChanged =
        status !== initialStatus || (needsDepartment && departmentId !== account.department?.id);
      if (assignmentChanged) {
        await api.assign(
          account.id,
          status === "guest" || status === "athlete"
            ? { kind: status }
            : { kind: status, departmentId },
        );
      }
      if (canGrantAdmin && admin !== (account.role === "admin")) {
        await api.setAdmin(account.id, admin);
      }
    },
    onSuccess: async () => {
      toast.success(`บันทึก ${account.name} แล้ว`);
      onClose();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["users"] }),
        queryClient.invalidateQueries({ queryKey: ["leadership"] }),
      ]);
    },
    onError: (error) => toast.error(`บันทึกไม่สำเร็จ: ${error.message}`),
  });

  const statusItems = STATUSES.map((value) => ({ value, label: ROLE_BADGES[value].label }));
  const departmentItems = departments.map((d) => ({
    value: d.id,
    label: <DepartmentLabel department={d} />,
  }));

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>แก้ไข {account.name}</AlertDialogTitle>
          <AlertDialogDescription>
            ออกจากตำแหน่งหัวหน้า/รองฯ จะลบตำแหน่งนั้นพร้อมช่องทางติดต่อ
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="account-status">สถานะ</FieldLabel>
            <Select
              items={statusItems}
              value={status}
              onValueChange={(value: Status | null) => value && setStatus(value)}
            >
              <SelectTrigger id="account-status" aria-label="สถานะ">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusItems.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {needsDepartment && (
            <Field>
              <FieldLabel htmlFor="account-department">ฝ่าย</FieldLabel>
              <Select
                items={departmentItems}
                value={departmentId || null}
                onValueChange={(value: string | null) => setDepartmentId(value ?? "")}
              >
                <SelectTrigger id="account-department" aria-label="ฝ่าย">
                  <SelectValue placeholder="เลือกฝ่าย" />
                </SelectTrigger>
                <SelectContent>
                  {departmentItems.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {occupant.data && (
                <FieldDescription>
                  จะแทนที่ {occupant.data.displayName} ซึ่งจะกลายเป็น Staff ของฝ่ายนี้
                </FieldDescription>
              )}
            </Field>
          )}
          {canGrantAdmin && (
            <Field orientation="horizontal">
              <Checkbox
                id="account-admin"
                checked={admin}
                // Removing your own admin role is refused by the server too.
                disabled={account.id === me?.id}
                onCheckedChange={(checked) => setAdmin(checked)}
              />
              <FieldLabel htmlFor="account-admin">Admin</FieldLabel>
            </Field>
          )}
        </FieldGroup>
        <AlertDialogFooter>
          <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
          <Button
            disabled={save.isPending || (needsDepartment && departmentId === "")}
            onClick={() => save.mutate()}
          >
            บันทึก
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
