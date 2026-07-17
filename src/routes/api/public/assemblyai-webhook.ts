import { createFileRoute } from "@tanstack/react-router";
import { runAnalysisOnTranscript } from "@/lib/analyze-pipeline.server";
import { logAnalysis } from "@/lib/analysis-logs.server";
import { getTranscript, buildTranscriptText } from "@/lib/assemblyai.server";

export const Route = createFileRoute("/api/public/assemblyai-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            transcript_id?: string;
            status?: string;
          };
          const transcriptId = body?.transcript_id;
          if (!transcriptId) {
            return new Response("missing transcript_id", { status: 400 });
          }

          const SUPABASE_URL = process.env.SUPABASE_URL;
          const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
          if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
            throw new Error("Supabase env not configured");

          const { createClient } = await import("@supabase/supabase-js");
          const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false },
          });

          const { data: row } = await admin
            .from("analyses")
            .select("id, topic, participants")
            .eq("provider_transcript_id", transcriptId)
            .maybeSingle();

          if (!row) {
            console.error("webhook: no analysis row for transcript_id", transcriptId);
            return new Response("unknown transcript_id", { status: 200 });
          }
          const analysisId = row.id as string;

          await logAnalysis(admin, analysisId, "webhook", "info", "Webhook received", {
            transcriptId,
            status: body?.status,
          });

          if (body?.status === "error") {
            const t = await getTranscript(transcriptId);
            await admin
              .from("analyses")
              .update({ status: "failed", error: t.error ?? "AssemblyAI error" })
              .eq("id", analysisId);
            return new Response("ok", { status: 200 });
          }

          // AssemblyAI retries the webhook if it doesn't get a fast response —
          // and our pipeline (OpenRouter chunking + synthesis) can easily take
          // longer than its retry window. Claim the row atomically so a
          // retried delivery for the same transcript doesn't start a second,
          // concurrent analysis run.
          const { data: claimed } = await admin
            .from("analyses")
            .update({ status: "analyzing" })
            .eq("id", analysisId)
            .eq("status", "transcribing")
            .select("id");
          if (!claimed || claimed.length === 0) {
            await logAnalysis(admin, analysisId, "webhook", "info", "Duplicate webhook delivery ignored", { transcriptId });
            return new Response("already processing", { status: 200 });
          }

          const t = await getTranscript(transcriptId);
          const { transcript, participants, duration_estimate } = buildTranscriptText(t);

          if (!transcript.trim()) {
            await admin
              .from("analyses")
              .update({
                status: "done",
                transcript: "",
                report: {
                  summary: "",
                  verdict: "Транскрипция пустая.",
                  overall_score: 0,
                  key_points: [],
                  decisions: [],
                  action_items: [],
                  questions_objections: [],
                  risks: [],
                  rules_assessment: [],
                  recommendations: [],
                  transcript: "",
                } as never,
              })
              .eq("id", analysisId);
            return new Response("ok", { status: 200 });
          }

          await runAnalysisOnTranscript({
            admin,
            analysisId,
            transcript,
            participants,
            duration_estimate,
            language: "ru",
            topic: row.topic ?? null,
            participantsHint: row.participants ?? null,
          });

          return new Response("ok", { status: 200 });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          console.error("assemblyai-webhook failed:", msg);
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});
