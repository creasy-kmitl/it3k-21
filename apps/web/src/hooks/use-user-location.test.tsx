import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";

import { useUserLocation } from "./use-user-location";

/**
 * jsdom has no geolocation, so the hook sees `navigator.geolocation` as
 * undefined. This stands a fake in its place that records the callbacks, so a
 * test can decide when the browser "answers" and then check what the hook did.
 */
function stubGeolocation() {
  let clears = 0;
  let succeed: ((position: GeolocationPosition) => void) | null = null;
  let fail: ((error: GeolocationPositionError) => void) | null = null;

  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition(onSuccess: (p: GeolocationPosition) => void, onError: (e: GeolocationPositionError) => void) {
        succeed = onSuccess;
        fail = onError;
        return 1;
      },
      clearWatch() {
        clears += 1;
      },
    },
  });

  return {
    // Wrapped in `act` because these fire React setters from outside React.
    succeedWith(position: GeolocationPosition) {
      act(() => succeed?.(position));
    },
    failWith(error: GeolocationPositionError) {
      act(() => fail?.(error));
    },
    clearCount: () => clears,
  };
}

function position(latitude: number, longitude: number, accuracy: number): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: Date.now(),
    toJSON: () => ({}),
  };
}

/** A bare object rather than a real GeolocationPositionError, which jsdom lacks. */
function geolocationError(code: number): GeolocationPositionError {
  return { code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: "stubbed" };
}

afterEach(() => {
  cleanup();
  // Leave the real (absent) geolocation in place for the next test.
  delete (navigator as { geolocation?: unknown }).geolocation;
});

describe("useUserLocation", () => {
  test("reports the position and 'granted' when the browser answers", () => {
    const geolocation = stubGeolocation();
    const { result } = renderHook(() => useUserLocation());

    geolocation.succeedWith(position(13.7299, 100.783, 20));

    expect(result.current.status).toBe("granted");
    expect(result.current.coords).toEqual({ lat: 13.7299, lng: 100.783, accuracy: 20 });
  });

  test("reports 'denied' when the user refuses permission", () => {
    const geolocation = stubGeolocation();
    const { result } = renderHook(() => useUserLocation());

    geolocation.failWith(geolocationError(1));

    expect(result.current.status).toBe("denied");
    expect(result.current.coords).toBeNull();
    // Denied is the outcome people hit most, so it has to come with copy to
    // act on rather than a silent failure.
    expect(result.current.message).not.toBeNull();
  });

  test("reports 'unavailable' when the fix times out", () => {
    const geolocation = stubGeolocation();
    const { result } = renderHook(() => useUserLocation());

    geolocation.failWith(geolocationError(3));

    expect(result.current.status).toBe("unavailable");
  });

  test("keeps watching on request without stacking a second watch", () => {
    const geolocation = stubGeolocation();
    const { result } = renderHook(() => useUserLocation());

    act(() => result.current.request());
    geolocation.succeedWith(position(13.73, 100.78, 25));

    expect(result.current.status).toBe("granted");
    // The first watch must have been cleared, or the GPS never turns off.
    expect(geolocation.clearCount()).toBe(1);
  });

  test("stops watching when the hook unmounts", () => {
    const geolocation = stubGeolocation();
    const { unmount } = renderHook(() => useUserLocation());

    geolocation.succeedWith(position(13.7299, 100.783, 20));
    unmount();

    // The battery-drain guard: without this the GPS radio stays on.
    expect(geolocation.clearCount()).toBeGreaterThan(0);
  });
});