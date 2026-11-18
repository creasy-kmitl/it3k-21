import { createFileRoute, redirect } from "@tanstack/react-router";

// The site is only the guide, so its root goes straight to it.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/docs/$", params: { _splat: "" } });
  },
});
