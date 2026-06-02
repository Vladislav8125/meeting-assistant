import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/analysis/$id")({
  beforeLoad: ({ params }) => { throw redirect({ to: "/app/meeting/$id", params }); },
});
