// The check-in kiosk's scanning pieces: which camera to use, how to read a
// CODE128 barcode from it, and a gate so one barcode held in front of the
// camera checks in once.

const CAMERA_KEY = "it3k:kiosk-camera";

export function savedCamera(): string | null {
  try {
    return localStorage.getItem(CAMERA_KEY);
  } catch {
    return null;
  }
}

export function saveCamera(deviceId: string) {
  try {
    localStorage.setItem(CAMERA_KEY, deviceId);
  } catch {
    // Private mode: the choice lasts until the page closes.
  }
}

/** Whether this browser can open a camera at all (not on plain http, nor in jsdom). */
export function canUseCamera() {
  return (
    typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/** The device's cameras; labels appear only after camera permission is granted. */
export async function listCameras(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "videoinput");
}

/** Opens `deviceId`, or the back camera when none is chosen. */
export function openCamera(deviceId: string | null) {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
  });
}

/** The camera after `current` in `cameras`, wrapping around. */
export function nextCamera(cameras: { deviceId: string }[], current: string | null) {
  if (cameras.length === 0) return null;
  const index = cameras.findIndex((camera) => camera.deviceId === current);
  return cameras[(index + 1) % cameras.length]?.deviceId ?? null;
}

export type Decoder = (video: HTMLVideoElement) => Promise<string | null>;

type NativeDetector = {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
};
type NativeDetectorClass = {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
};

/**
 * Reads CODE128 (what /me shows) from a video frame: the browser's own
 * BarcodeDetector when it has one, otherwise zxing compiled to WebAssembly,
 * whose .wasm file is part of this app's build rather than a CDN download.
 */
export async function createDecoder(): Promise<Decoder> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (
    Native &&
    (await Native.getSupportedFormats().catch((): string[] => [])).includes("code_128")
  ) {
    const detector = new Native({ formats: ["code_128"] });
    return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
  }

  const [{ prepareZXingModule, readBarcodes }, { default: wasmUrl }] = await Promise.all([
    import("zxing-wasm/reader"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  prepareZXingModule({ overrides: { locateFile: () => wasmUrl }, fireImmediately: true });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    if (!context || video.videoWidth === 0) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const [result] = await readBarcodes(image, { formats: ["Code128"], maxNumberOfSymbols: 1 });
    return result?.isValid ? result.text : null;
  };
}

/**
 * Lets a code through once, then holds it back for `cooldownMs` so a badge
 * left in front of the camera is not scanned again and again. A different
 * code passes straight away.
 */
export function createScanGate(cooldownMs: number, now: () => number = Date.now) {
  let last: { code: string; at: number } | null = null;
  return (raw: string) => {
    const code = raw.trim();
    if (!code) return null;
    const time = now();
    if (last && last.code === code && time - last.at < cooldownMs) return null;
    last = { code, at: time };
    return code;
  };
}
