import { can } from "@it3k/auth/permissions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@it3k/ui/components/alert-dialog";
import { Button } from "@it3k/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@it3k/ui/components/card";
import { Input } from "@it3k/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { Building2, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  DEPARTMENT_COLORS,
  DEPARTMENT_COLOR_KEYS,
  DEPARTMENT_ICONS,
  DEPARTMENT_ICON_KEYS,
  DepartmentIcon,
  type DepartmentColorKey,
  type DepartmentIconKey,
} from "@/components/department-icon";
import { PageHeader } from "@/components/page-header";
import { type Department, type DepartmentInput, departmentsApi } from "@/lib/departments";
import { isSignedOut } from "@/lib/leadership";

export const Route = createFileRoute("/staff/departments")({
  component: RouteComponent,
  beforeLoad: ({ context }) => {
    if (!can(context.session.data?.user.role, { department: ["read"] })) {
      throw redirect({ to: "/staff/dashboard" });
    }
  },
  // Not a query, so the router's 401 handling does not see it: sign in and come back.
  loader: async ({ location }) => {
    try {
      return await departmentsApi.list();
    } catch (error) {
      if (isSignedOut(error)) throw redirect({ to: "/login", search: { to: location.href } });
      throw error;
    }
  },
});

function RouteComponent() {
  const departments = Route.useLoaderData();
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const user = session.data?.user;

  const canCreate = can(user?.role, { department: ["create"] });
  const canDelete = can(user?.role, { department: ["delete"] });
  const canEdit = can(user?.role, { department: ["update"] });

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toast.success(success);
      await router.invalidate();
      return true;
    } catch (error) {
      if (isSignedOut(error)) {
        void router.navigate({ to: "/login", search: { to: router.state.location.href } });
        return false;
      }
      toast.error(error instanceof Error ? error.message : "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง");
      return false;
    }
  }

  return (
    // The shared column is wide; a one-line form and short rows read better narrower.
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader icon={Building2} title="ฝ่าย" description={`ทั้งหมด ${departments.length} ฝ่าย`} />

      {canCreate && (
        <DepartmentForm
          submitLabel="เพิ่มฝ่าย"
          onSubmit={(input) => run(() => departmentsApi.create(input), "เพิ่มฝ่ายแล้ว")}
        />
      )}

      <ul className="flex flex-col gap-2">
        {departments.map((d) => (
          <DepartmentItem
            key={d.id}
            department={d}
            canEdit={canEdit}
            canDelete={canDelete}
            onUpdate={(input) =>
              run(() => departmentsApi.update(d.id, input), "บันทึกแล้ว")
            }
            onDelete={() => run(() => departmentsApi.remove(d.id), "ลบแล้ว")}
          />
        ))}
      </ul>
    </div>
  );
}

function DepartmentItem({
  department,
  canEdit,
  canDelete,
  onUpdate,
  onDelete,
}: {
  department: Department;
  canEdit: boolean;
  canDelete: boolean;
  onUpdate: (input: DepartmentInput) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li>
        <DepartmentForm
          initial={department}
          submitLabel="บันทึก"
          onCancel={() => setEditing(false)}
          onSubmit={async (input) => {
            const ok = await onUpdate(input);
            if (ok) setEditing(false);
            return ok;
          }}
        />
      </li>
    );
  }

  return (
    <li>
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DepartmentIcon department={department} />
            {department.name}
          </CardTitle>
          <CardDescription className="flex items-center gap-1">
            <Users className="size-3.5" />
            {department.memberCount}
            {department.description && <span className="ml-2">· {department.description}</span>}
          </CardDescription>
          {(canEdit || canDelete) && (
            <CardAction className="flex gap-1">
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`แก้ไข ${department.name}`}
                  onClick={() => setEditing(true)}
                >
                  <Pencil />
                </Button>
              )}
              {canDelete && <DeleteDepartmentButton department={department} onDelete={onDelete} />}
            </CardAction>
          )}
        </CardHeader>
      </Card>
    </li>
  );
}

function DeleteDepartmentButton({
  department,
  onDelete,
}: {
  department: Department;
  onDelete: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`ลบ ${department.name}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="text-destructive" />
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>ลบ {department.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            สมาชิกของฝ่ายนี้จะไม่มีฝ่าย บัญชีผู้ใช้จะไม่ถูกลบ
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              const ok = await onDelete();
              setPending(false);
              if (ok) setOpen(false);
            }}
          >
            ลบ
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DepartmentForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: DepartmentInput;
  submitLabel: string;
  onSubmit: (input: DepartmentInput) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [icon, setIcon] = useState<DepartmentIconKey>(initial?.icon ?? "folder");
  const [color, setColor] = useState<DepartmentColorKey>(initial?.color ?? "slate");
  const [pending, setPending] = useState(false);

  return (
    <Card size="sm">
      <CardContent>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            const ok = await onSubmit({ name, description: description || null, icon, color });
            setPending(false);
            if (ok && !initial) {
              setName("");
              setDescription("");
              setIcon("folder");
              setColor("slate");
            }
          }}
        >
          <IconPicker icon={icon} color={color} onChange={setIcon} />
          <ColorPicker color={color} onChange={setColor} />
          <Input
            placeholder="ชื่อฝ่าย"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
          <Input
            placeholder="คำอธิบาย"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || !name.trim()}>
              {!initial && <Plus />}
              {submitLabel}
            </Button>
            {onCancel && (
              <Button type="button" variant="ghost" onClick={onCancel}>
                ยกเลิก
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function IconPicker({
  icon,
  color,
  onChange,
}: {
  icon: DepartmentIconKey;
  color: DepartmentColorKey;
  onChange: (icon: DepartmentIconKey) => void;
}) {
  return (
    <Select
      value={icon}
      onValueChange={(value: DepartmentIconKey | null) => {
        if (value) onChange(value);
      }}
    >
      <SelectTrigger aria-label="ไอคอน" className="shrink-0">
        <SelectValue>
          {(value: DepartmentIconKey) => <DepartmentIcon department={{ icon: value, color }} />}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        className="w-auto min-w-0"
        listClassName="grid grid-cols-6 gap-1"
      >
        {DEPARTMENT_ICON_KEYS.map((key) => {
          const Icon = DEPARTMENT_ICONS[key];
          return (
            // Square cells: the selection shows as a tint, not the check mark.
            <SelectItem
              key={key}
              value={key}
              aria-label={key}
              className="size-9 justify-center p-0 data-selected:bg-foreground/10 *:first:justify-center *:[span]:last:hidden!"
            >
              <Icon />
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function ColorPicker({
  color,
  onChange,
}: {
  color: DepartmentColorKey;
  onChange: (color: DepartmentColorKey) => void;
}) {
  return (
    <Select
      value={color}
      onValueChange={(value: DepartmentColorKey | null) => {
        if (value) onChange(value);
      }}
    >
      <SelectTrigger aria-label="สี" className="shrink-0">
        <SelectValue>{(value: DepartmentColorKey) => <Swatch color={value} />}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {DEPARTMENT_COLOR_KEYS.map((key) => (
          <SelectItem key={key} value={key}>
            <Swatch color={key} />
            <span className="capitalize">{key}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Swatch({ color }: { color: DepartmentColorKey }) {
  return (
    <span
      aria-hidden
      className={`inline-flex size-5 items-center justify-center rounded-full ${DEPARTMENT_COLORS[color]}`}
    >
      <span className="size-2.5 rounded-full bg-current" />
    </span>
  );
}
