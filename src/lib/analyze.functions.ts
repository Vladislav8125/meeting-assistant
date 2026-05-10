import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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

// Build webhook URL using the project's stable URL.
// VITE_SUPABASE_PROJECT_ID is unrelated; the Lovable project ID is hardcoded in
// stable URL form: project--{lovable-project-id}.lovable.app
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
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
      throw new Error("Supabase env not configured");

    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    try {
      // Title carries analysisId so the webhook can map back to our row.
      const title = `lvb-${data.analysisId}`;

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
      }>(mutation, {
        input: {
          url: data.publicUrl,
          title,
          webhook: WEBHOOK_URL,
          language: "ru",
        },
      });

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
        })
        .eq("id", data.analysisId);

      return { ok: true, async: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      console.error("analyzeRecording failed:", message);
      await admin
        .from("analyses")
        .update({ status: "failed", error: message })
        .eq("id", data.analysisId);
      return { ok: false, error: message };
    }
  });

// Manually re-trigger the entire pipeline for a record.
// Strategy: first check if Fireflies already has a transcript with our title
// (then run the analysis directly); otherwise re-upload the file to Fireflies.
export const retryAnalysis = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ analysisId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const admin = await getAdmin();
    try {
      const { data: row, error } = await admin
        .from("analyses")
        .select("id, storage_path, mime_type, topic, participants")
        .eq("id", data.analysisId)
        .single();
      if (error || !row) throw new Error("Запись не найдена");

      // Reset to transcribing so UI reflects retry immediately.
      await admin
        .from("analyses")
        .update({ status: "transcribing", error: null })
        .eq("id", data.analysisId);

      // 1) Try to pick up an existing Fireflies transcript by title
      const { findTranscriptByTitle, buildTranscriptText } = await import(
        "@/lib/fireflies.server"
      );
      const { runAnalysisOnTranscript } = await import(
        "@/lib/analyze-pipeline.server"
      );
      const existing = await findTranscriptByTitle(`lvb-${data.analysisId}`);
      if (existing) {
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

      // 2) Re-upload to Fireflies
      const { data: pub } = admin.storage
        .from("media")
        .getPublicUrl(row.storage_path as string);
      const publicUrl = pub.publicUrl;
      if (!publicUrl) throw new Error("Не удалось получить ссылку на файл");

      const title = `lvb-${data.analysisId}`;
      const result = await fireflies<{
        uploadAudio: { success: boolean; message?: string };
      }>(
        `mutation($input: AudioUploadInput!) {
          uploadAudio(input: $input) { success title message }
        }`,
        { input: { url: publicUrl, title, webhook: WEBHOOK_URL, language: "ru" } },
      );
      if (!result.uploadAudio?.success) {
        throw new Error(
          "Fireflies отклонил загрузку: " +
            (result.uploadAudio?.message ?? "неизвестная причина"),
        );
      }
      return { ok: true, mode: "reuploaded" as const };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      await admin
        .from("analyses")
        .update({ status: "failed", error: msg })
        .eq("id", data.analysisId);
      return { ok: false, error: msg };
    }
  });

// Trigger the polling endpoint from the client (kicks the queue without waiting for cron).
export const kickPoll = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const url = `https://project--${PROJECT_ID}.lovable.app/api/public/poll-fireflies`;
    const r = await fetch(url, { method: "POST" });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
});
