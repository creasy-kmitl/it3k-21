import { can } from "@it3k/auth/permissions";
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
import { Pencil, Plus, Trash2, Users } from "lucide-react";
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
import { type Department, type DepartmentInput, departmentsApi } from "@/lib/departments";

export const Route = createFileRoute("/_auth/departments")({
  component: RouteComponent,
  beforeLoad: ({ context }) => {
    if (!can(context.session.data?.user.role, { department: ["read"] })) {
      throw redirect({ to: "/dashboard" });
    }
  },
  loader: () => departmentsApi.list(),
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
      toast.error(error instanceof Error ? error.message : "Something went wrong");
      return false;
    }
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">ฝ่าย</h1>
        <p className="text-muted-foreground">{departments.length} departments</p>
      </header>

      {canCreate && (
        <DepartmentForm
          submitLabel="Create"
          onSubmit={(input) => run(() => departmentsApi.create(input), "Department created")}
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
              run(() => departmentsApi.update(d.id, input), "Department updated")
            }
            onDelete={() => {
              if (confirm(`Delete "${d.name}"? Members will be unassigned.`)) {
                void run(() => departmentsApi.remove(d.id), "Department deleted");
              }
            }}
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
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li>
        <DepartmentForm
          initial={department}
          submitLabel="Save"
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
                  aria-label="Edit"
                  onClick={() => setEditing(true)}
                >
                  <Pencil />
                </Button>
              )}
              {canDelete && (
                <Button variant="ghost" size="icon" aria-label="Delete" onClick={onDelete}>
                  <Trash2 className="text-destructive" />
                </Button>
              )}
            </CardAction>
          )}
        </CardHeader>
      </Card>
    </li>
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
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
          <Input
            placeholder="Description"
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
                Cancel
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
      <SelectTrigger aria-label="Icon" className="shrink-0">
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
      <SelectTrigger aria-label="Color" className="shrink-0">
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
