import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@it3k/ui/components/empty";
import type { LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/page-header";

/**
 * Stands in for a competition page until its stream builds it. Each stream
 * replaces its route's component and stops using this.
 */
export function StreamPlaceholder({
  icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader icon={icon} title={title} description={description} />
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyTitle>หน้านี้กำลังสร้าง</EmptyTitle>
          <EmptyDescription>ระบบการแข่งขันกำลังทยอยเปิดใช้</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
