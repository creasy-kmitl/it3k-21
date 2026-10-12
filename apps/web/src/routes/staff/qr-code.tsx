import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { QrStudio } from "@/components/qr-studio";

// `text` starts the studio on that content, e.g. a short link's QR URL.
const searchSchema = z.object({ text: z.string().max(4096).optional().catch(undefined) });

export const Route = createFileRoute("/staff/qr-code")({
  validateSearch: (search) => searchSchema.parse(search),
  component: QrCodePage,
});

function QrCodePage() {
  const { text } = Route.useSearch();
  // Keyed so opening the studio from another link starts over with its text.
  return <QrStudio key={text} initialText={text} />;
}
