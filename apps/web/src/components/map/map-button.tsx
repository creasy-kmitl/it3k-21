import { LoaderCircleIcon, LocateFixedIcon, MapIcon, MapPinnedIcon, RefreshCwIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@it3k/ui/components/dialog";

// Imported as a type on purpose: a value import here would pull map-view into
// the main bundle and undo the lazy loading above.
import type { CenterRequest, CenterTarget } from "@/components/map/map-view";
import { type Segment, SegmentedControl } from "@/components/segmented-control";
import { useUserLocation } from "@/hooks/use-user-location";

/**
 * Leaflet and react-leaflet are a sizeable dependency and the map is not
 * visible until the button is tapped. Loading it lazily splits them into a
 * separate chunk fetched on first open, instead of costing every visit the
 * bytes on first paint.
 */
const MapView = lazy(() =>
  import("@/components/map/map-view").then((module) => ({ default: module.MapView })),
);

const CENTER_SEGMENTS: Segment<CenterTarget>[] = [
  { value: "user", label: "ตำแหน่งของฉัน", icon: LocateFixedIcon },
  { value: "venue", label: "จุดเริ่มต้น", icon: MapPinnedIcon },
];

/** Everything inside the dialog: status, the map, and the centre control. */
function MapPanel() {
  const { status, coords, message, request } = useUserLocation();
  // One request object rather than a target plus a counter: `nonce` changes on
  // every request so that asking for the anchor that is already selected still
  // flies there. A segmented control is a radio, so re-picking the option that
  // is already active fires no change of its own.
  const [centerRequest, setCenterRequest] = useState<CenterRequest>({
    target: "venue",
    nonce: 0,
  });

  const choose = (target: CenterTarget) => {
    setCenterRequest((previous) => ({ target, nonce: previous.nonce + 1 }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* `pr-12` clears the dialog's close button: that button is `size-8` pinned
          at `right-4`, so it covers the band from 16px to 48px off the right
          edge, and anything under 48px of padding-right sits beneath it.
          Both `p-4` and `pr-12` end up in the class list — tailwind-merge does
          not resolve a shorthand against one of its sides — so this relies on
          Tailwind emitting `padding-right` after `padding`, which it does. */}
      <div className="flex items-start justify-between gap-2 border-b p-4 pr-12">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-base font-medium">แผนที่ KMITL</h2>
          <p className="text-sm text-muted-foreground">พิกัดกลางและตำแหน่งของคุณ</p>
        </div>
        <Badge variant={status === "granted" ? "default" : "secondary"} className="shrink-0">
          {status === "granted" ? "กำลังระบุตำแหน่ง" : "ไม่ได้ระบุตำแหน่ง"}
        </Badge>
      </div>

      {/* Denied is the outcome people hit most, so it gets real copy rather
          than a toast they have already dismissed. */}
      {message && (
        <div className="flex flex-col gap-2 border-b bg-muted p-3 text-xs text-muted-foreground">
          <p>{message}</p>
          <Button variant="outline" size="xs" onClick={request} className="w-fit">
            <RefreshCwIcon />
            ลองอีกครั้ง
          </Button>
        </div>
      )}

      {/* `min-h-0` is required: without it a flex child with `h-full` grows
          past its container instead of shrinking, and the map overflows the
          dialog. */}
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <LoaderCircleIcon className="size-5 animate-spin" />
              <span className="sr-only">กำลังโหลดแผนที่</span>
            </div>
          }
        >
          <MapView user={coords} request={centerRequest} />
        </Suspense>
      </div>

      <div className="border-t p-3">
        <SegmentedControl
          label="จุดที่แผนที่จะโฟกัส"
          value={centerRequest.target}
          onChange={choose}
          segments={CENTER_SEGMENTS}
          className="w-full"
        />
      </div>
    </div>
  );
}

/**
 * The floating trigger, pinned to the bottom-right of every staff page, and the
 * dialog it opens.
 *
 * The map opens in a dialog centred on the screen at every width, rather than
 * sliding in from an edge: a side panel is unusable on a phone, and an
 * edge-anchored one needs different sizes and anchors per breakpoint — one
 * centred box is the same on both, and is only ever too small at one size,
 * which is easier to fix.
 */
export function MapButton() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            size="lg"
            // z-40 keeps the trigger behind the dialog's z-50 backdrop, so the
            // dimmed overlay covers it instead of leaving a stray floating
            // button sitting on the dimmed page.
            className="fixed right-5 bottom-5 z-40 shadow-lg md:right-6 md:bottom-6"
          />
        }
      >
        <MapIcon />
        แผนที่
      </DialogTrigger>

      <DialogContent
        // These replace shadcn's dialog defaults, which cap at `sm:max-w-md`
        // and pad with `p-6` — both too small for a map. `cn` runs them
        // through tailwind-merge, so listing the replacements here is enough.
        //
        // `flex flex-col` replaces the default `grid`, which lets the panel fill
        // the height instead of sizing to its content. `dvh` tracks the mobile
        // viewport as browser chrome slides away; plain `vh` would leave part
        // of the map hidden under the URL bar.
        className="flex h-[88dvh] max-w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:h-[82vh] sm:max-w-4xl"
      >
        {/* Visually hidden: gives the dialog its accessible name, which screen
            readers need and the visible panel heading would not provide. */}
        <DialogHeader className="sr-only">
          <DialogTitle>แผนที่ KMITL</DialogTitle>
          <DialogDescription>
            แสดงพิกัดกลางของพื้นที่งานและตำแหน่งของคุณ
          </DialogDescription>
        </DialogHeader>

        <MapPanel />
      </DialogContent>
    </Dialog>
  );
}