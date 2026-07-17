import { createFileRoute } from "@tanstack/react-router";
import { runAnalysisOnTranscript } from "@/lib/analyze-pipeline.server";
import { getTranscript, buildTranscriptText } from "@/lib/assemblyai.server";
import { logAnalysis } from "@/lib/analysis-logs.server";

const STUCK_AFTER_MIN = 90; // mark failed after this many minutes
const POLL_BATCH = 10;

export const Route = createFileRoute("/api/public/poll-assemblyai")({
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
      .select("id, created_at, topic, participants, provider_transcript_id")
      .eq("status", "transcribing")
      .order("created_at", { ascending: true })
      .limit(POLL_BATCH);

    if (error) throw error;
    const items = rows ?? [];

    const results: Array<{ id: string; outcome: string; detail?: string }> = [];

    for (const row of items) {
      const id = row.id as string;
      const transcriptId = row.provider_transcript_id as string | null;
      const ageMin =
        (Date.now() - new Date(row.created_at as string).getTime()) / 60000;

      if (!transcriptId) {
        if (ageMin > STUCK_AFTER_MIN) {
          await admin
            .from("analyses")
            .update({ status: "failed", error: "Нет provider_transcript_id" })
            .eq("id", id);
          results.push({ id, outcome: "timeout" });
        }
        continue;
      }

      try {
        const t = await getTranscript(transcriptId);

        if (t.status === "error") {
          await admin
            .from("analyses")
            .update({ status: "failed", error: t.error ?? "AssemblyAI error" })
            .eq("id", id);
          await logAnalysis(admin, id, "poll", "error", "AssemblyAI reported error", { error: t.error });
          results.push({ id, outcome: "error" });
          continue;
        }

        if (t.status !== "completed") {
          if (ageMin > STUCK_AFTER_MIN) {
            const errMsg = `AssemblyAI не завершил транскрибацию за ${Math.round(ageMin)} мин`;
            await admin
              .from("analyses")
              .update({ status: "failed", error: errMsg })
              .eq("id", id);
            await logAnalysis(admin, id, "poll", "error", "Timeout", { ageMin: Math.round(ageMin) });
            results.push({ id, outcome: "timeout" });
          } else {
            await logAnalysis(admin, id, "poll", "info", "Still processing in AssemblyAI", {
              ageMin: Math.round(ageMin),
              status: t.status,
            });
            results.push({ id, outcome: "pending" });
          }
          continue;
        }

        await logAnalysis(admin, id, "poll", "info", "Transcript ready in AssemblyAI", {
          transcript_id: t.id,
          duration: t.audio_duration,
          utterances: t.utterances?.length ?? 0,
        });

        const { transcript, participants, duration_estimate } = buildTranscriptText(t);

        if (!transcript.trim()) {
          await admin
            .from("analyses")
            .update({ status: "failed", error: "Пустая транскрипция от AssemblyAI" })
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
        console.error("poll-assemblyai item failed", id, msg);
        results.push({ id, outcome: "error", detail: msg });
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
    console.error("poll-assemblyai failed:", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
