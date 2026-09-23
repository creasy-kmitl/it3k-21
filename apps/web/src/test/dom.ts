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
globals.window = dom.window;
globals.document = dom.window.document;
globals.navigator = dom.window.navigator;
globals.IS_REACT_ACT_ENVIRONMENT = true;

export { dom };
