import { createFileRoute } from "@tanstack/react-router";
import { createFromSource } from "fumadocs-core/search/server";

import { source } from "@/lib/source";

// No `language`: the default multilingual tokenizer splits words with
// `Intl.Segmenter`, which knows where Thai words end. An Orama language such
// as "english" splits on spaces only, and Thai has none between words.
const server = createFromSource(source);

export const Route = createFileRoute("/api/search")({
  server: {
    handlers: {
      GET: async ({ request }) => server.GET(request),
    },
  },
});
