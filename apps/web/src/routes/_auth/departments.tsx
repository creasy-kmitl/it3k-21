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
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
    <div className="container mx-auto flex max-w-3xl flex-col gap-4 px-6 py-10">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">ฝ่าย</h1>
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
          <CardTitle>{department.name}</CardTitle>
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
  const [pending, setPending] = useState(false);

  return (
    <Card size="sm">
      <CardContent>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            const ok = await onSubmit({ name, description: description || null });
            setPending(false);
            if (ok && !initial) {
              setName("");
              setDescription("");
            }
          }}
        >
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
