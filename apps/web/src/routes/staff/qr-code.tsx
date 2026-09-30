import { createFileRoute } from "@tanstack/react-router";

import { QrStudio } from "@/components/qr-studio";

export const Route = createFileRoute("/staff/qr-code")({
  component: QrStudio,
});
