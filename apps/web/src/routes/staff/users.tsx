import { createFileRoute } from "@tanstack/react-router";

import UserManager from "@/components/user-manager";

export const Route = createFileRoute("/staff/users")({
  component: UserManager,
});
