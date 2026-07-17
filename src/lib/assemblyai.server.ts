// Server-only helpers for AssemblyAI — direct API, no platform proxy.
const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2";

function authHeaders() {
  const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
  if (!ASSEMBLYAI_API_KEY) throw new Error("ASSEMBLYAI_API_KEY not configured");
  return {
    Authorization: ASSEMBLYAI_API_KEY,
    "Content-Type": "application/json",
  };
}

export type SubmitTranscriptParams = {
  audioUrl: string;
  webhookUrl: string;
};

// Step 1: submit a file (by URL) for transcription. Returns immediately with
// an id + status "queued" — the actual work happens async, delivered via webhook.
export async function submitTranscript(
  params: SubmitTranscriptParams,
): Promise<{ id: string; status: string }> {
  const resp = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      audio_url: params.audioUrl,
      webhook_url: params.webhookUrl,
      speaker_labels: true,
      language_code: "ru",
    }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`AssemblyAI ${resp.status}: ${text.slice(0, 400)}`);
  const json = JSON.parse(text) as { id: string; status: string; error?: string };
  if (json.error) throw new Error("AssemblyAI: " + json.error);
  return json;
}

export type AATranscript = {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  error?: string;
  audio_duration: number | null;
  utterances:
    | { text: string; speaker: string | null }[]
    | null;
  text: string | null;
};

// Step 2: fetch full transcript by id (called from the webhook handler, or
// from retry/poll paths using a previously-stored id).
export async function getTranscript(id: string): Promise<AATranscript> {
  const resp = await fetch(`${ASSEMBLYAI_BASE}/transcript/${id}`, {
    headers: authHeaders(),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`AssemblyAI ${resp.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text) as AATranscript;
}

export function buildTranscriptText(t: AATranscript): {
  transcript: string;
  participants: { label: string; role_guess: string; talk_share_pct: number }[];
  duration_estimate: string;
} {
  const utterances = t.utterances ?? [];

  const speakerLabel = (speaker: string | null) =>
    speaker ? `Спикер ${speaker}` : "Спикер";

  const transcript = utterances.length
    ? utterances.map((u) => `[${speakerLabel(u.speaker)}]: ${u.text ?? ""}`.trim()).join("\n")
    : (t.text ?? "");

  const speakers = Array.from(
    new Set(utterances.map((u) => speakerLabel(u.speaker))),
  );
  const totalChars = utterances.reduce((a, u) => a + (u.text?.length ?? 0), 0);
  const participants = speakers.map((label) => {
    const own = utterances
      .filter((u) => speakerLabel(u.speaker) === label)
      .reduce((a, u) => a + (u.text?.length ?? 0), 0);
    return {
      label,
      role_guess: "",
      talk_share_pct: totalChars ? Math.round((own / totalChars) * 100) : 0,
    };
  });

  const duration_estimate = t.audio_duration
    ? `${Math.round(t.audio_duration / 60)} мин`
    : "неизвестно";

  return { transcript, participants, duration_estimate };
}
