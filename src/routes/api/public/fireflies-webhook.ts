import { createFileRoute } from "@tanstack/react-router";
import { runAnalysisOnTranscript } from "@/lib/analyze-pipeline.server";
import { logAnalysis } from "@/lib/analysis-logs.server";

const FIREFLIES_URL = "https://connector-gateway.lovable.dev/fireflies/graphql";

async function fireflies<T>(
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
  if (!resp.ok)
    throw new Error(`Fireflies ${resp.status}: ${text.slice(0, 400)}`);
  const json: { data?: T; errors?: { message: string }[] } = JSON.parse(text);
  if (json.errors?.length)
    throw new Error("Fireflies: " + json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new Error("Fireflies: пустой ответ");
  return json.data;
}

export const Route = createFileRoute("/api/public/fireflies-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            meetingId?: string;
            eventType?: string;
          };
          const meetingId = body?.meetingId;
          if (!meetingId) {
            return new Response("missing meetingId", { status: 400 });
          }

          const SUPABASE_URL = process.env.SUPABASE_URL;
          const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
          if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
            throw new Error("Supabase env not configured");

          const { createClient } = await import("@supabase/supabase-js");
          const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false },
          });

          // Fetch transcript with sentences
          const data = await fireflies<{
            transcript: {
              id: string;
              title: string;
              duration: number | null;
              sentences: { text: string; speaker_name: string | null }[] | null;
              meeting_attendees:
                | { displayName: string | null; email: string | null }[]
                | null;
            };
          }>(
            `query($id: String!) {
              transcript(id: $id) {
                id
                title
                duration
                sentences { text speaker_name }
                meeting_attendees { displayName email }
              }
            }`,
            { id: meetingId },
          );

          const t = data.transcript;
          const title = t?.title ?? "";
          const m = title.match(/lvb-([0-9a-f-]{36})/i);
          if (!m) {
            console.error("webhook: unrecognised title", title);
            return new Response("unknown title", { status: 200 });
          }
          const analysisId = m[1];

          const sentences = t.sentences ?? [];
          const transcript = sentences
            .map(
              (s) =>
                `[${s.speaker_name ?? "Спикер"}]: ${s.text ?? ""}`.trim(),
            )
            .join("\n");

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

          // Pull topic/participants hint from row
          const { data: row } = await admin
            .from("analyses")
            .select("topic, participants")
            .eq("id", analysisId)
            .single();

          const speakers = Array.from(
            new Set(sentences.map((s) => s.speaker_name).filter(Boolean)),
          ) as string[];
          const totalChars = sentences.reduce(
            (a, s) => a + (s.text?.length ?? 0),
            0,
          );
          const participants = speakers.map((label) => {
            const own = sentences
              .filter((s) => s.speaker_name === label)
              .reduce((a, s) => a + (s.text?.length ?? 0), 0);
            return {
              label,
              role_guess: "",
              talk_share_pct: totalChars
                ? Math.round((own / totalChars) * 100)
                : 0,
            };
          });

          const duration_estimate = t.duration
            ? `${Math.round(t.duration / 60)} мин`
            : "неизвестно";

          await runAnalysisOnTranscript({
            admin,
            analysisId,
            transcript,
            participants,
            duration_estimate,
            language: "ru",
            topic: row?.topic ?? null,
            participantsHint: row?.participants ?? null,
          });

          return new Response("ok", { status: 200 });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          console.error("fireflies-webhook failed:", msg);
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});
