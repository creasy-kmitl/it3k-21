import { createFileRoute } from "@tanstack/react-router";

import UserManager from "@/components/user-manager";

export const Route = createFileRoute("/_auth/users")({
  component: UserManager,
});
