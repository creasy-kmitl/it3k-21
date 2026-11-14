import { useCallback, useEffect, useRef, useState } from "react";

export type LocationStatus =
  /** Watching has not started yet. */
  | "idle"
  /** The browser permission prompt is open, or a fix is being acquired. */
  | "loading"
  /** We have a position and are tracking it. */
  | "granted"
  /** The user said no. Browsers treat this as sticky, so asking again rarely works. */
  | "denied"
  /** No geolocation here, or a timeout. */
  | "unavailable";

export type Coords = {
  lat: number;
  lng: number;
  /** Radius of uncertainty in metres. */
  accuracy: number;
};

export type UserLocation = {
  status: LocationStatus;
  coords: Coords | null;
  /** Thai copy for any status the user needs to act on. */
  message: string | null;
  /** Ask the browser again; useful after a timeout or an "unavailable" result. */
  request: () => void;
};

const MESSAGES: Record<LocationStatus, string | null> = {
  idle: null,
  loading: null,
  granted: null,
  denied:
    "คุณไม่ได้อนุญาตให้เว็บไซต์ดูตำแหน่ง แผนที่ยังแสดงพิกัดกลางได้ตามปกติ " +
    "หากต้องการกลับมาใช้งาน ให้เปิดการตั้งค่าเว็บไซต์ในเบราว์เซอร์แล้วเลือกอนุญาต",
  unavailable:
    "เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง หรือหาตำแหน่งไม่สำเร็จ " +
    "แผนที่ยังแสดงพิกัดกลางได้ตามปกติ",
};

/**
 * Tracks the browser's position for as long as `enabled` is true.
 *
 * Two things worth knowing about this hook:
 *
 * 1. `watchPosition` is used, not `getCurrentPosition`. `getCurrentPosition`
 *    fires exactly once and hands back a stale fix; `watchPosition` keeps
 *    calling as the device moves, and returns a handle that must be passed to
 *    `clearWatch`.
 * 2. Browser callbacks are not React state. `watchPosition` calls back on the
 *    device's own schedule, outside React's render cycle, so every callback
 *    here calls a setter to tell React the value changed. Without that the
 *    marker would freeze at its first position.
 *
 * Nothing is sent anywhere: coordinates live in this component's memory and go
 * away when the dialog closes.
 */
export function useUserLocation(enabled = true): UserLocation {
  const [status, setStatus] = useState<LocationStatus>("idle");
  const [coords, setCoords] = useState<Coords | null>(null);
  const watchRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watchRef.current === null) return;
    // Without this the GPS radio stays on after the map is closed, draining
    // battery on every visit.
    navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
  }, []);

  const start = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      return;
    }

    // Replace any existing watch rather than stacking a second one.
    stop();
    setStatus((current) => (current === "granted" ? current : "loading"));

    watchRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
        setStatus("granted");
      },
      (error) => {
        setCoords(null);
        setStatus(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      {
        enableHighAccuracy: true,
        // Reuse a fix younger than 10s instead of waking the GPS again.
        maximumAge: 10_000,
        // Give up rather than leaving the UI spinning forever indoors.
        timeout: 15_000,
      },
    );
  }, [stop]);

  useEffect(() => {
    if (!enabled) {
      stop();
      setStatus("idle");
      return;
    }
    start();
    return stop;
  }, [enabled, start, stop]);

  return { status, coords, message: MESSAGES[status], request: start };
}