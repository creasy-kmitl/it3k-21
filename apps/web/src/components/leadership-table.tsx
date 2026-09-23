import { Badge } from "@it3k/ui/components/badge";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@it3k/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@it3k/ui/components/table";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { type ReactNode, useMemo } from "react";

import type { LeadershipSummary } from "@/lib/leadership";

export const ROLE_LABELS: Record<LeadershipSummary["role"], string> = {
  head: "หัวหน้าฝ่าย",
  vicehead: "รองหัวหน้าฝ่าย",
};

export function RoleBadge({ role }: { role: LeadershipSummary["role"] }) {
  return <Badge variant={role === "head" ? "default" : "secondary"}>{ROLE_LABELS[role]}</Badge>;
}

const features = tableFeatures({});
const column = createColumnHelper<typeof features, LeadershipSummary>();

type Props = {
  departmentName: string;
  seats: LeadershipSummary[];
  /** Contact / edit / delete controls for one seat, decided by the parent. */
  renderActions: (seat: LeadershipSummary) => ReactNode;
};

/** Desktop table; the same seats render as cards below the `md` breakpoint. */
export default function LeadershipTable({ departmentName, seats, renderActions }: Props) {
  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("role", {
          header: "ตำแหน่ง",
          cell: (info) => <RoleBadge role={info.getValue()} />,
        }),
        column.accessor("displayName", { header: "ชื่อ" }),
        column.display({
          id: "actions",
          header: () => <span className="sr-only">การดำเนินการ</span>,
          cell: (info) => (
            <div className="flex justify-end gap-1">{renderActions(info.row.original)}</div>
          ),
        }),
      ]),
    [renderActions],
  );
  const table = useTable({ features, columns, data: seats, getRowId: (seat) => seat.id });

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={header.id === "actions" ? "w-0" : undefined}
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul aria-label={departmentName} className="flex flex-col gap-2 md:hidden">
        {seats.map((seat) => (
          <li key={seat.id}>
            <Card size="sm">
              <CardHeader>
                <CardTitle>{seat.displayName}</CardTitle>
                <CardDescription>
                  <RoleBadge role={seat.role} />
                </CardDescription>
                <CardAction className="flex gap-1">{renderActions(seat)}</CardAction>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
