import { cn } from "@it3k/ui/lib/utils";
import { useRouterState } from "@tanstack/react-router";

/**
 * A thin bar along the top of the screen while the router loads the next
 * page, so every navigation shows it is underway without replacing the page.
 * It fades in after a short delay, so near-instant navigations do not flash.
 */
export function NavigationProgress() {
  const loading = useRouterState({ select: (state) => state.isLoading });

  return (
    <div
      role="progressbar"
      aria-label="กำลังเปลี่ยนหน้า"
      aria-hidden={!loading}
      data-loading={loading}
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden transition-opacity",
        loading ? "opacity-100 delay-150" : "opacity-0 duration-300",
      )}
    >
      <div className="h-full w-1/3 animate-navigation-progress bg-primary" />
    </div>
  );
}
