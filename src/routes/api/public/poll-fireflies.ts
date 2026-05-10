import { createFileRoute } from "@tanstack/react-router";
import { runAnalysisOnTranscript } from "@/lib/analyze-pipeline.server";
import { findTranscriptByTitle, buildTranscriptText } from "@/lib/fireflies.server";
import { logAnalysis } from "@/lib/analysis-logs.server";

const STUCK_AFTER_MIN = 90; // mark failed after this many minutes
const POLL_BATCH = 10;

export const Route = createFileRoute("/api/public/poll-fireflies")({
  server: {
    handlers: {
      GET: async () => handle(),
      POST: async () => handle(),
    },
  },
});

async function handle() {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
      throw new Error("Supabase env not configured");

    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: rows, error } = await admin
      .from("analyses")
      .select("id, created_at, topic, participants")
      .eq("status", "transcribing")
      .order("created_at", { ascending: true })
      .limit(POLL_BATCH);

    if (error) throw error;
    const items = rows ?? [];

    const results: Array<{ id: string; outcome: string; detail?: string }> = [];

    for (const row of items) {
      const id = row.id as string;
      const ageMin =
        (Date.now() - new Date(row.created_at as string).getTime()) / 60000;
      try {
        const t = await findTranscriptByTitle(`lvb-${id}`);
        if (!t) {
          if (ageMin > STUCK_AFTER_MIN) {
            await admin
              .from("analyses")
              .update({
                status: "failed",
                error: `Fireflies не вернул транскрипт за ${Math.round(ageMin)} мин`,
              })
              .eq("id", id);
            results.push({ id, outcome: "timeout" });
          } else {
            results.push({ id, outcome: "pending" });
          }
          continue;
        }

        const { transcript, participants, duration_estimate } =
          buildTranscriptText(t);

        if (!transcript.trim()) {
          await admin
            .from("analyses")
            .update({
              status: "failed",
              error: "Пустая транскрипция от Fireflies",
            })
            .eq("id", id);
          results.push({ id, outcome: "empty" });
          continue;
        }

        await runAnalysisOnTranscript({
          admin,
          analysisId: id,
          transcript,
          participants,
          duration_estimate,
          language: "ru",
          topic: (row.topic as string | null) ?? null,
          participantsHint: (row.participants as string | null) ?? null,
        });
        results.push({ id, outcome: "completed" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        console.error("poll-fireflies item failed", id, msg);
        results.push({ id, outcome: "error", detail: msg });
        // don't mark failed on transient errors unless very old
        if (ageMin > STUCK_AFTER_MIN) {
          await admin
            .from("analyses")
            .update({ status: "failed", error: msg })
            .eq("id", id);
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed: results.length, results }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("poll-fireflies failed:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
