import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ffQuery as fireflies } from "@/lib/fireflies.server";

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
const WEBHOOK_URL = `${APP_URL}/api/public/fireflies-webhook`;

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
      const title = `lvb-${data.analysisId}`;
      const variables = {
        input: { url: data.publicUrl, title, webhook: WEBHOOK_URL },
      };
      await logAnalysis(admin, data.analysisId, "fireflies", "info", "uploadAudio request", variables);

      const mutation = `
        mutation($input: AudioUploadInput!) {
          uploadAudio(input: $input) {
            success
            title
            message
          }
        }
      `;

      const result = await fireflies<{
        uploadAudio: { success: boolean; title?: string; message?: string };
      }>(mutation, variables);

      await logAnalysis(admin, data.analysisId, "fireflies", "info", "uploadAudio response", result);

      if (!result.uploadAudio?.success) {
        throw new Error(
          "Fireflies отклонил загрузку: " +
            (result.uploadAudio?.message ?? "неизвестная причина"),
        );
      }

      await admin
        .from("analyses")
        .update({
          status: "transcribing",
          error: null,
          language: "ru", // expected by default; refined post-transcription
          recipient_email: data.recipientEmail ?? null,
        })
        .eq("id", data.analysisId);

      return { ok: true, async: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      console.error("analyzeRecording failed:", message);
      await logAnalysis(admin, data.analysisId, "fireflies", "error", "uploadAudio failed", message);
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
        .select("id, storage_path, mime_type, topic, participants, recipient_email")
        .eq("id", data.analysisId)
        .single();
      if (error || !row) throw new Error("Запись не найдена");

      await admin
        .from("analyses")
        .update({ status: "transcribing", error: null })
        .eq("id", data.analysisId);

      await logAnalysis(admin, data.analysisId, "pipeline", "info", "Retry requested");

      const { findTranscriptByTitle, buildTranscriptText } = await import(
        "@/lib/fireflies.server"
      );
      const { runAnalysisOnTranscript } = await import(
        "@/lib/analyze-pipeline.server"
      );
      const existing = await findTranscriptByTitle(`lvb-${data.analysisId}`);
      if (existing) {
        await logAnalysis(admin, data.analysisId, "fireflies", "info", "Existing transcript found", { id: existing.id, title: existing.title, duration: existing.duration });
        const { transcript, participants, duration_estimate } =
          buildTranscriptText(existing);
        if (transcript.trim()) {
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

      const { data: signed, error: signErr } = await admin.storage
        .from("media")
        .createSignedUrl(row.storage_path as string, 60 * 60 * 24);
      if (signErr || !signed?.signedUrl) throw signErr ?? new Error("Не удалось получить ссылку на файл");
      const publicUrl = signed.signedUrl;

      const title = `lvb-${data.analysisId}`;
      const variables = { input: { url: publicUrl, title, webhook: WEBHOOK_URL } };
      await logAnalysis(admin, data.analysisId, "fireflies", "info", "Re-uploadAudio request", variables);
      const result = await fireflies<{
        uploadAudio: { success: boolean; message?: string };
      }>(
        `mutation($input: AudioUploadInput!) {
          uploadAudio(input: $input) { success title message }
        }`,
        variables,
      );
      await logAnalysis(admin, data.analysisId, "fireflies", "info", "Re-uploadAudio response", result);
      if (!result.uploadAudio?.success) {
        throw new Error(
          "Fireflies отклонил загрузку: " +
            (result.uploadAudio?.message ?? "неизвестная причина"),
        );
      }
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
    const url = `${APP_URL}/api/public/poll-fireflies`;
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
