import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/prepare")({
  beforeLoad: () => { throw redirect({ to: "/app/matrix" }); },
});
