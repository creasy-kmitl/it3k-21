// Test-only: gives `bun test` a jsdom window. Preloaded from the root
// bunfig.toml so the DOM exists before react-dom and Testing Library load.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

const globals = globalThis as Record<string, unknown>;

for (const key of Object.getOwnPropertyNames(dom.window)) {
  // Keep Bun's own fetch/Request/Response/URL etc.; only add what is missing.
  if (key in globalThis) continue;
  globals[key] = Reflect.get(dom.window, key);
}
// Libraries build AbortControllers from Bun's global, but jsdom's
// addEventListener only accepts its own AbortSignal. Take Bun's too: listen
// without it and remove the listener when it aborts.
// A function, not an inline instanceof, which would narrow Bun's signal to never.
const isJsdomSignal = (signal: AbortSignal) =>
  signal instanceof (dom.window.AbortSignal as unknown as typeof AbortSignal);
const target = dom.window.EventTarget.prototype;
const addEventListener = target.addEventListener;
target.addEventListener = function (
  this: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions,
) {
  const signal = typeof options === "object" ? options.signal : undefined;
  if (!signal || isJsdomSignal(signal)) {
    return addEventListener.call(this, type, listener, options);
  }
  if (signal.aborted) return;
  const { signal: _bunSignal, ...rest } = options as AddEventListenerOptions;
  addEventListener.call(this, type, listener, rest);
  signal.addEventListener("abort", () => this.removeEventListener(type, listener, rest), {
    once: true,
  });
};

globals.window = dom.window;
globals.document = dom.window.document;
globals.navigator = dom.window.navigator;
globals.IS_REACT_ACT_ENVIRONMENT = true;

export { dom };
