import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { submitTranscript, getTranscript, buildTranscriptText } from "@/lib/assemblyai.server";

async function logAnalysis(
  admin: SupabaseClient,
  analysisId: string,
  source: string,
  level: "info" | "warn" | "error",
  message: string,
  data?: unknown,
) {
  const m = await import("@/lib/analysis-logs.server");
  return m.logAnalysis(admin, analysisId, source, level, message, data);
}

async function getAdmin() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("Supabase env not configured");
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const APP_URL = process.env.PUBLIC_APP_URL || "http://localhost:3000";
const WEBHOOK_URL = `${APP_URL}/api/public/assemblyai-webhook`;

export const analyzeRecording = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        analysisId: z.string().uuid(),
        publicUrl: z.string().url(),
        mimeType: z.string().min(1).max(100),
        topic: z.string().max(500).optional(),
        participants: z.string().max(1000).optional(),
        recipientEmail: z.string().email().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const admin = await getAdmin();

    try {
      await logAnalysis(admin, data.analysisId, "assemblyai", "info", "submitTranscript request", {
        audioUrl: data.publicUrl,
        webhookUrl: WEBHOOK_URL,
      });

      const result = await submitTranscript({
        audioUrl: data.publicUrl,
        webhookUrl: WEBHOOK_URL,
      });

      await logAnalysis(admin, data.analysisId, "assemblyai", "info", "submitTranscript response", result);

      await admin
        .from("analyses")
        .update({
          status: "transcribing",
          error: null,
          language: "ru",
          recipient_email: data.recipientEmail ?? null,
          provider_transcript_id: result.id,
        })
        .eq("id", data.analysisId);

      return { ok: true, async: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      console.error("analyzeRecording failed:", message);
      await logAnalysis(admin, data.analysisId, "assemblyai", "error", "submitTranscript failed", message);
      await admin
        .from("analyses")
        .update({ status: "failed", error: message })
        .eq("id", data.analysisId);
      return { ok: false, error: message };
    }
  });

export const retryAnalysis = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ analysisId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const admin = await getAdmin();
    try {
      const { data: row, error } = await admin
        .from("analyses")
        .select("id, storage_path, mime_type, topic, participants, recipient_email, provider_transcript_id")
        .eq("id", data.analysisId)
        .single();
      if (error || !row) throw new Error("Запись не найдена");

      await admin
        .from("analyses")
        .update({ status: "transcribing", error: null })
        .eq("id", data.analysisId);

      await logAnalysis(admin, data.analysisId, "pipeline", "info", "Retry requested");

      const existingId = row.provider_transcript_id as string | null;
      if (existingId) {
        const existing = await getTranscript(existingId);
        if (existing.status === "completed") {
          await logAnalysis(admin, data.analysisId, "assemblyai", "info", "Existing transcript found", {
            id: existing.id,
            duration: existing.audio_duration,
          });
          const { transcript, participants, duration_estimate } = buildTranscriptText(existing);
          if (transcript.trim()) {
            const { runAnalysisOnTranscript } = await import("@/lib/analyze-pipeline.server");
            await runAnalysisOnTranscript({
              admin,
              analysisId: data.analysisId,
              transcript,
              participants,
              duration_estimate,
              language: "ru",
              topic: (row.topic as string | null) ?? null,
              participantsHint: (row.participants as string | null) ?? null,
            });
            return { ok: true, mode: "from-existing-transcript" as const };
          }
        }
      }

      const { data: signed, error: signErr } = await admin.storage
        .from("media")
        .createSignedUrl(row.storage_path as string, 60 * 60 * 24);
      if (signErr || !signed?.signedUrl) throw signErr ?? new Error("Не удалось получить ссылку на файл");

      await logAnalysis(admin, data.analysisId, "assemblyai", "info", "Re-submitting to AssemblyAI");
      const result = await submitTranscript({
        audioUrl: signed.signedUrl,
        webhookUrl: WEBHOOK_URL,
      });
      await logAnalysis(admin, data.analysisId, "assemblyai", "info", "Re-submit response", result);

      await admin
        .from("analyses")
        .update({ provider_transcript_id: result.id })
        .eq("id", data.analysisId);

      return { ok: true, mode: "reuploaded" as const };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      await logAnalysis(admin, data.analysisId, "pipeline", "error", "Retry failed", msg);
      await admin
        .from("analyses")
        .update({ status: "failed", error: msg })
        .eq("id", data.analysisId);
      return { ok: false, error: msg };
    }
  });

export const kickPoll = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const url = `${APP_URL}/api/public/poll-assemblyai`;
    const r = await fetch(url, { method: "POST" });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
});

// Manually re-send the report by email (useful when address was missing initially)
export const sendReportEmail = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        analysisId: z.string().uuid(),
        recipientEmail: z.string().email().max(200),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const admin = await getAdmin();
    try {
      await admin
        .from("analyses")
        .update({ recipient_email: data.recipientEmail })
        .eq("id", data.analysisId);

      const { sendAnalysisReport } = await import("@/lib/email-report.server");
      const res = await sendAnalysisReport(admin, data.analysisId, data.recipientEmail);
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return { ok: false, error: msg };
    }
  });
