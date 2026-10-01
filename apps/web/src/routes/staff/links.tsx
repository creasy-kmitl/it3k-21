import { createFileRoute } from "@tanstack/react-router";
import z from "zod";

import { LinksPage } from "@/components/links/links-page";
import { optional } from "@/lib/list-search";

const searchSchema = z.object({
  q: optional(z.string().max(64)),
  mine: optional(z.boolean()),
  tag: optional(z.string().max(64)),
});

export const Route = createFileRoute("/staff/links")({
  validateSearch: (search) => searchSchema.parse(search),
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <LinksPage
      filters={{
        value: search,
        onChange: (patch) =>
          void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true }),
      }}
    />
  );
}
