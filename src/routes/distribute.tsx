import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/distribute")({
  beforeLoad: () => { throw redirect({ to: "/app/meeting" }); },
});
