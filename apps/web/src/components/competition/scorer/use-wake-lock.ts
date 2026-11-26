import { useEffect } from "react";

/**
 * Keeps the screen on while `enabled`, so a scorer's phone does not sleep
 * mid-rally. The browser drops the lock when the tab is hidden; it is asked
 * for again when the tab comes back. Browsers without the API just sleep.
 */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let active = true;
    const request = async () => {
      try {
        const next = await navigator.wakeLock.request("screen");
        if (active) lock = next;
        else void next.release();
      } catch {
        // Refused (low battery, not visible): the page still works.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && (!lock || lock.released)) void request();
    };
    void request();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => undefined);
    };
  }, [enabled]);
}
