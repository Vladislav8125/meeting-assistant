import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/distribute/$id")({
  beforeLoad: ({ params }) => { throw redirect({ to: "/app/meeting/$id", params }); },
});
