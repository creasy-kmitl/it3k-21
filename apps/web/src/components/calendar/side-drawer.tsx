import { Button } from "@it3k/ui/components/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@it3k/ui/components/drawer";
import { XIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { useMediaQuery } from "@/hooks/use-media-query";

/** Phones get a bottom sheet; wider screens a panel from the right. */
const NARROW = "(max-width: 767px)";

/**
 * The calendar's side panel: a drawer from the right that can be swiped
 * away, or from the bottom on phones. The body scrolls; the header stays.
 */
export function SideDrawer({
  open,
  onOpenChange,
  title,
  description,
  width = "36rem",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Panel width on wider screens. */
  width?: string;
  children: ReactNode;
}) {
  const narrow = useMediaQuery(NARROW);
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      swipeDirection={narrow ? "down" : "right"}
      showSwipeHandle={narrow}
    >
      <DrawerContent
        // The drawer sizes itself from this variable; inline beats its default.
        style={
          narrow
            ? undefined
            : ({ "--drawer-content-width": `min(${width}, 92vw)` } as CSSProperties)
        }
      >
        <DrawerHeader className="flex-row items-start gap-2 text-left">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <DrawerTitle>{title}</DrawerTitle>
            {description && <DrawerDescription render={<div />}>{description}</DrawerDescription>}
          </div>
          <DrawerClose render={<Button variant="ghost" size="icon-sm" aria-label="ปิด" />}>
            <XIcon />
          </DrawerClose>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
