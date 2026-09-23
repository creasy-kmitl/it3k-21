import { createFileRoute } from "@tanstack/react-router";

import Unauthorized from "@/components/unauthorized";

export const Route = createFileRoute("/unauthorized")({
  component: Unauthorized,
});
