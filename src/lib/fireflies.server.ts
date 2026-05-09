// Server-only helpers for Fireflies GraphQL via Lovable connector gateway.
const FIREFLIES_URL = "https://connector-gateway.lovable.dev/fireflies/graphql";

export async function ffQuery<T>(
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
  if (!resp.ok) throw new Error(`Fireflies ${resp.status}: ${text.slice(0, 400)}`);
  const json: { data?: T; errors?: { message: string }[] } = JSON.parse(text);
  if (json.errors?.length)
    throw new Error("Fireflies: " + json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new Error("Fireflies: пустой ответ");
  return json.data;
}

export type FFTranscript = {
  id: string;
  title: string;
  duration: number | null;
  sentences: { text: string; speaker_name: string | null }[] | null;
};

// Find a transcript by our correlation title `lvb-<analysisId>`.
// Returns null if Fireflies hasn't produced it yet.
export async function findTranscriptByTitle(
  title: string,
): Promise<FFTranscript | null> {
  // First: list recent transcripts matching title
  const list = await ffQuery<{ transcripts: { id: string; title: string }[] | null }>(
    `query($title: String, $limit: Int) {
      transcripts(title: $title, limit: $limit) { id title }
    }`,
    { title, limit: 5 },
  );
  const match = list.transcripts?.find((t) => t.title === title);
  if (!match) return null;

  const full = await ffQuery<{ transcript: FFTranscript }>(
    `query($id: String!) {
      transcript(id: $id) {
        id title duration
        sentences { text speaker_name }
      }
    }`,
    { id: match.id },
  );
  return full.transcript;
}

export function buildTranscriptText(t: FFTranscript): {
  transcript: string;
  participants: { label: string; role_guess: string; talk_share_pct: number }[];
  duration_estimate: string;
} {
  const sentences = t.sentences ?? [];
  const transcript = sentences
    .map((s) => `[${s.speaker_name ?? "Спикер"}]: ${s.text ?? ""}`.trim())
    .join("\n");

  const speakers = Array.from(
    new Set(sentences.map((s) => s.speaker_name).filter(Boolean)),
  ) as string[];
  const totalChars = sentences.reduce((a, s) => a + (s.text?.length ?? 0), 0);
  const participants = speakers.map((label) => {
    const own = sentences
      .filter((s) => s.speaker_name === label)
      .reduce((a, s) => a + (s.text?.length ?? 0), 0);
    return {
      label,
      role_guess: "",
      talk_share_pct: totalChars ? Math.round((own / totalChars) * 100) : 0,
    };
  });

  const duration_estimate = t.duration
    ? `${Math.round(t.duration / 60)} мин`
    : "неизвестно";

  return { transcript, participants, duration_estimate };
}
