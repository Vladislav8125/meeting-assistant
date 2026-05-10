// Server-only analysis pipeline (chunking + synthesis).
// Used by Fireflies webhook after transcription completes.
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAnalysis, detectLanguage } from "@/lib/analysis-logs.server";
import { sendAnalysisReport } from "@/lib/email-report.server";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const ANALYZE_MODEL = "google/gemini-2.5-flash";

const CHUNK_PROMPT = `Ты — аналитик деловых совещаний. Тебе дан ФРАГМЕНТ транскрипта.
Извлеки только то, что реально присутствует во фрагменте. Не выдумывай.
Верни СТРОГО JSON:
{
  "key_points": ["..."],
  "decisions": ["..."],
  "action_items": [{ "task": "что", "owner": "кто или ''", "deadline": "когда или ''" }],
  "questions_objections": ["..."],
  "risks": ["..."],
  "rule_signals": [{ "id": 1, "score": 0-10, "evidence": "цитата или ''" }]
}
"rule_signals" — оценки наблюдаемые в этом фрагменте по 16 правилам успешного совещания (id 1..16).
Если правило не проявлено — НЕ включай его в rule_signals.`;

const SYNTH_PROMPT = `Ты — старший аналитик. На входе обзор транскрипта и агрегированные находки.
Сгенерируй итоговый отчёт. Дедуплицируй, объедини похожие пункты.
Верни СТРОГО валидный JSON:
{
  "summary": "2-4 предложения",
  "goal": { "stated": "...", "clarity_score": 0-10, "comment": "..." },
  "key_points": ["..."],
  "decisions": ["..."],
  "action_items": [{ "task": "...", "owner": "...", "deadline": "..." }],
  "questions_objections": ["..."],
  "risks": ["..."],
  "rules_assessment": [
    { "id": 1, "title": "Определи цель", "score": 0-10, "evidence": "...", "recommendation": "..." },
    { "id": 2, "title": "Определи участников и ответственных", "score": 0-10, "evidence": "...", "recommendation": "..." },
    { "id": 3, "title": "Сверху вниз — от крупного к мелкому", "score": 0-10, "evidence": "...", "recommendation": "..." },
    { "id": 4, "title": "Качественная письменная подготовка", "score": 0-10, "evidence": "...", "recommendation": "..." },
    { "id": 5, "title": "Учти вопросы и возражения заранее", "score": 0-10, "evidence": "...", "recommendation": "..." },
    { "id": 6, "title": "Приходи с решением, а не проблемой", "score": 0-10, "evidence": "...", "recommendation": "..." },
    { "id": 7, "title": "Нет подготовки — нет совещания", "score": 0-10, "evidence": "...", "recommendation": "..." },
    { "id": 8, "title": "Дай время обдумать", "score": 0-10, "evidence": "...", "recommendation": "..." },
    { "id": 9, "title": "Готовятся все участники", "score": 0-10, "evidence": "...", "recommendation": "..." },
    { "id": 10, "title": "Говори коротко", "score": 0-10, "evidence": "...", "recommendation": "..." },
    { "id": 11, "title": "Не уходи от темы", "score": 0-10, "evidence": "...", "recommendation": "..." },
    { "id": 12, "title": "Оперируй фактами, избегай манипуляций", "score": 0-10, "evidence": "...", "recommendation": "..." },
    { "id": 13, "title": "Следи за временем", "score": 0-10, "evidence": "...", "recommendation": "..." },
    { "id": 14, "title": "Фиксируй принятые решения", "score": 0-10, "evidence": "...", "recommendation": "..." },
    { "id": 15, "title": "Принятые решения обязательны к исполнению", "score": 0-10, "evidence": "...", "recommendation": "..." },
    { "id": 16, "title": "Инвестируй сэкономленное время", "score": 0-10, "evidence": "...", "recommendation": "..." }
  ],
  "overall_score": 0-100,
  "verdict": "1-2 предложения",
  "recommendations": ["..."]
}
overall_score = средневзвешенное по rules_assessment * 10 (округлить).`;

type ChunkFinding = {
  key_points?: string[];
  decisions?: string[];
  action_items?: { task: string; owner?: string; deadline?: string }[];
  questions_objections?: string[];
  risks?: string[];
  rule_signals?: { id: number; score: number; evidence?: string }[];
};

function chunkText(text: string, size = 6000, overlap = 400): string[] {
  if (!text) return [];
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + size, text.length);
    chunks.push(text.slice(i, end));
    if (end === text.length) break;
    i = end - overlap;
  }
  return chunks;
}

function parseJsonLoose(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Не удалось распарсить JSON-ответ модели");
    return JSON.parse(m[0]);
  }
}

async function callAI(apiKey: string, messages: unknown[]): Promise<string> {
  const resp = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ANALYZE_MODEL,
      messages,
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    if (resp.status === 429) throw new Error("Rate limit ИИ. Попробуйте позже.");
    if (resp.status === 402) throw new Error("Закончился баланс Lovable AI.");
    throw new Error(`AI gateway ${resp.status}: ${t.slice(0, 300)}`);
  }
  const ai = await resp.json();
  const content = ai?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Пустой ответ от модели");
  return content;
}

export async function runAnalysisOnTranscript(params: {
  admin: SupabaseClient;
  analysisId: string;
  transcript: string;
  participants?: { label: string; role_guess?: string; talk_share_pct?: number }[];
  duration_estimate?: string;
  language?: string;
  topic?: string | null;
  participantsHint?: string | null;
}) {
  const { admin, analysisId, transcript } = params;
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

  const userMeta = [
    params.topic ? `Тема встречи: ${params.topic}` : null,
    params.participantsHint ? `Участники: ${params.participantsHint}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const detectedLang = detectLanguage(transcript);
  await logAnalysis(admin, analysisId, "pipeline", "info", "Transcript received", {
    chars: transcript.length,
    detected_language: detectedLang,
  });

  await admin
    .from("analyses")
    .update({ status: "analyzing", transcript, language: detectedLang })
    .eq("id", analysisId);

  // Stage 2: chunked analysis (parallel)
  const chunks = chunkText(transcript, 6000, 400);
  await logAnalysis(admin, analysisId, "pipeline", "info", `Chunking: ${chunks.length} fragments`);
  const findings: ChunkFinding[] = await Promise.all(
    chunks.map(async (chunk, idx) => {
      try {
        const content = await callAI(LOVABLE_API_KEY, [
          { role: "system", content: CHUNK_PROMPT },
          {
            role: "user",
            content:
              `Фрагмент ${idx + 1} из ${chunks.length}.\n` +
              (userMeta ? userMeta + "\n" : "") +
              `--- НАЧАЛО ---\n${chunk}\n--- КОНЕЦ ---`,
          },
        ]);
        return parseJsonLoose(content) as ChunkFinding;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        console.error("chunk failed", idx, e);
        await logAnalysis(admin, analysisId, "pipeline", "warn", `Chunk ${idx + 1} failed`, msg);
        return {};
      }
    }),
  );

  // Stage 3: synth
  await admin
    .from("analyses")
    .update({ status: "synthesizing" })
    .eq("id", analysisId);

  const agg = {
    key_points: findings.flatMap((f) => f.key_points ?? []),
    decisions: findings.flatMap((f) => f.decisions ?? []),
    action_items: findings.flatMap((f) => f.action_items ?? []),
    questions_objections: findings.flatMap((f) => f.questions_objections ?? []),
    risks: findings.flatMap((f) => f.risks ?? []),
    rule_signals: findings.flatMap((f) => f.rule_signals ?? []),
  };

  const overview =
    transcript.length > 4000
      ? transcript.slice(0, 2000) +
        "\n\n[...пропущено...]\n\n" +
        transcript.slice(-2000)
      : transcript;

  const synthContent = await callAI(LOVABLE_API_KEY, [
    { role: "system", content: SYNTH_PROMPT },
    {
      role: "user",
      content:
        (userMeta ? userMeta + "\n\n" : "") +
        `Чанков: ${chunks.length}.\n\n` +
        `=== ОБЗОР ТРАНСКРИПТА ===\n${overview}\n\n` +
        `=== НАХОДКИ ===\n${JSON.stringify(agg).slice(0, 60000)}`,
    },
  ]);

  const synth = parseJsonLoose(synthContent) as Record<string, unknown>;

  const report = {
    language: detectedLang || params.language,
    duration_estimate: params.duration_estimate,
    participants: params.participants ?? [],
    ...synth,
    transcript,
  };

  await admin
    .from("analyses")
    .update({ status: "done", transcript, report: report as never, error: null })
    .eq("id", analysisId);

  await logAnalysis(admin, analysisId, "pipeline", "info", "Analysis complete", {
    overall_score: (synth as { overall_score?: number }).overall_score,
  });

  // Auto-send report by email if recipient was provided at upload time
  try {
    const { data: row } = await admin
      .from("analyses")
      .select("recipient_email, email_sent_at")
      .eq("id", analysisId)
      .single();
    const to = row?.recipient_email as string | null | undefined;
    if (to && !row?.email_sent_at) {
      await sendAnalysisReport(admin, analysisId, to);
    }
  } catch (e) {
    await logAnalysis(admin, analysisId, "email", "warn", "Auto-send skipped", e instanceof Error ? e.message : "unknown");
  }
}

