import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

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

const FIREFLIES_URL = "https://connector-gateway.lovable.dev/fireflies/graphql";

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

const PROJECT_ID = "e71eef0d-2665-4ba3-ac78-e7a2c5599aac";
const WEBHOOK_URL = `https://project--${PROJECT_ID}.lovable.app/api/public/fireflies-webhook`;

async function fireflies<T = unknown>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const FIREFLIES_API_KEY = process.env.FIREFLIES_API_KEY;
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
  if (!FIREFLIES_API_KEY) throw new Error("FIREFLIES_API_KEY not configured");

  const resp = await fetch(FIREFLIES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": FIREFLIES_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Fireflies ${resp.status}: ${text.slice(0, 400)}`);
  }
  let json: { data?: T; errors?: { message: string }[] };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Fireflies ответ не JSON: ${text.slice(0, 200)}`);
  }
  if (json.errors?.length) {
    throw new Error(
      "Fireflies: " + json.errors.map((e) => e.message).join("; "),
    );
  }
  if (!json.data) throw new Error("Fireflies: пустой ответ");
  return json.data;
}

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
    const url = `https://project--${PROJECT_ID}.lovable.app/api/public/poll-fireflies`;
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
