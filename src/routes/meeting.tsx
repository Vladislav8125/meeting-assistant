import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/meeting")({
  beforeLoad: () => { throw redirect({ to: "/app/meeting" }); },
});
