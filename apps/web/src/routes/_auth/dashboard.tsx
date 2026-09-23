import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/dashboard")({
  component: RouteComponent,
});

function RouteComponent() {
  const { session } = Route.useRouteContext();

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome {session.data?.user.name}</p>
      <Link to="/head" className="text-primary underline-offset-4 hover:underline">
        หัวหน้าฝ่าย
      </Link>
    </div>
  );
}
