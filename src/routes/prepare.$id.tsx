import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/prepare/$id")({
  beforeLoad: ({ params }) => { throw redirect({ to: "/app/matrix/$id", params }); },
});
