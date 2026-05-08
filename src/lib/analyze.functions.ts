import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const TRANSCRIBE_MODEL = "google/gemini-2.5-flash";
const ANALYZE_MODEL = "google/gemini-2.5-flash";

// ---------- Prompts ----------

const TRANSCRIBE_PROMPT = `Ты — профессиональный транскрибатор деловых записей.
Сделай ПОЛНУЮ дословную транскрипцию приложенной аудио/видео-записи.
Размечай реплики как [Спикер 1]: ..., [Спикер 2]: ...
Сохраняй всё содержание, включая повторы, паузы (...) и важные эмоциональные маркеры.
Верни СТРОГО JSON:
{
  "language": "ru" | "en" | "other",
  "duration_estimate": "строка вида '12 мин' или 'неизвестно'",
  "participants": [{ "label": "Спикер 1", "role_guess": "роль/функция или ''", "talk_share_pct": 0-100 }],
  "transcript": "полный текст с метками спикеров"
}
Если запись пустая/нечитаемая — верни transcript: "" и language: "other".`;

const CHUNK_PROMPT = `Ты — аналитик деловых совещаний. Тебе дан ФРАГМЕНТ транскрипта.
Извлеки из него только то, что реально присутствует во фрагменте. Не выдумывай.
Верни СТРОГО JSON:
{
  "key_points": ["..."],
  "decisions": ["..."],
  "action_items": [{ "task": "что", "owner": "кто или ''", "deadline": "когда или ''" }],
  "questions_objections": ["..."],
  "risks": ["..."],
  "rule_signals": [
    { "id": 1, "score": 0-10, "evidence": "цитата/факт из фрагмента или ''" }
  ]
}
"rule_signals" — оценки наблюдаемые в этом фрагменте по 16 правилам успешного совещания (id 1..16).
Если правило в этом фрагменте не проявлено — НЕ включай его в rule_signals.`;

const SYNTH_PROMPT = `Ты — старший аналитик. На входе:
1) Краткий обзор транскрипта (начало + конец).
2) Агрегированные находки по чанкам (тезисы/решения/action items/вопросы/риски).

Сгенерируй итоговый отчёт. Дедуплицируй, объедини похожие пункты, сохрани суть.
Верни СТРОГО валидный JSON по схеме:
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

// ---------- Helpers ----------

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

async function callAI(
  apiKey: string,
  model: string,
  messages: unknown[],
): Promise<string> {
  const resp = await fetch(AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    if (resp.status === 429)
      throw new Error("Превышен лимит запросов к ИИ. Попробуйте позже.");
    if (resp.status === 402)
      throw new Error(
        "Закончился баланс Lovable AI. Пополните в настройках workspace.",
      );
    throw new Error(`AI gateway ${resp.status}: ${t.slice(0, 300)}`);
  }
  const ai = await resp.json();
  const content = ai?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Пустой ответ от модели");
  return content;
}

// ---------- Main ----------

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
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
      throw new Error("Supabase env not configured");

    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const setStatus = (status: string, error: string | null = null) =>
      admin
        .from("analyses")
        .update({ status, error })
        .eq("id", data.analysisId);

    await setStatus("transcribing");

    try {
      // ---- Stage 1: transcribe by URL (avoid OOM on large files) ----
      const userMeta = [
        data.topic ? `Тема встречи: ${data.topic}` : null,
        data.participants ? `Участники: ${data.participants}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      const transcribeContent = await callAI(LOVABLE_API_KEY, TRANSCRIBE_MODEL, [
        { role: "system", content: TRANSCRIBE_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                (userMeta ? userMeta + "\n\n" : "") +
                "Транскрибируй запись и верни JSON по схеме.",
            },
            {
              type: "image_url",
              image_url: { url: data.publicUrl },
            },
          ],
        },
      ]);

      const trData = parseJsonLoose(transcribeContent) as {
        language?: string;
        duration_estimate?: string;
        participants?: { label: string; role_guess?: string; talk_share_pct?: number }[];
        transcript?: string;
      };
      const transcript = (trData.transcript ?? "").trim();

      if (!transcript) {
        await admin
          .from("analyses")
          .update({
            status: "done",
            transcript: "",
            report: {
              language: trData.language ?? "other",
              duration_estimate: trData.duration_estimate ?? "неизвестно",
              participants: trData.participants ?? [],
              summary: "",
              verdict: "Запись пустая или нечитаемая.",
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
          .eq("id", data.analysisId);
        return { ok: true };
      }

      // Persist transcript early so UI can show it while we analyze
      await admin
        .from("analyses")
        .update({ status: "analyzing", transcript })
        .eq("id", data.analysisId);

      // ---- Stage 2: chunked analysis ----
      const chunks = chunkText(transcript, 6000, 400);
      const findings: ChunkFinding[] = await Promise.all(
        chunks.map(async (chunk, idx) => {
          const content = await callAI(LOVABLE_API_KEY, ANALYZE_MODEL, [
            { role: "system", content: CHUNK_PROMPT },
            {
              role: "user",
              content:
                `Фрагмент ${idx + 1} из ${chunks.length}.\n` +
                (userMeta ? userMeta + "\n" : "") +
                `--- НАЧАЛО ФРАГМЕНТА ---\n${chunk}\n--- КОНЕЦ ФРАГМЕНТА ---`,
            },
          ]);
          try {
            return parseJsonLoose(content) as ChunkFinding;
          } catch {
            return {};
          }
        }),
      );

      // ---- Stage 3: synthesize ----
      await setStatus("synthesizing");

      // Aggregate findings (raw, dedup happens in synthesis)
      const agg = {
        key_points: findings.flatMap((f) => f.key_points ?? []),
        decisions: findings.flatMap((f) => f.decisions ?? []),
        action_items: findings.flatMap((f) => f.action_items ?? []),
        questions_objections: findings.flatMap(
          (f) => f.questions_objections ?? [],
        ),
        risks: findings.flatMap((f) => f.risks ?? []),
        rule_signals: findings.flatMap((f) => f.rule_signals ?? []),
      };

      // Provide a transcript overview to keep prompt small (head + tail)
      const overview =
        transcript.length > 4000
          ? transcript.slice(0, 2000) +
            "\n\n[...пропущено...]\n\n" +
            transcript.slice(-2000)
          : transcript;

      const synthContent = await callAI(LOVABLE_API_KEY, ANALYZE_MODEL, [
        { role: "system", content: SYNTH_PROMPT },
        {
          role: "user",
          content:
            (userMeta ? userMeta + "\n\n" : "") +
            `Чанков: ${chunks.length}.\n\n` +
            `=== ОБЗОР ТРАНСКРИПТА ===\n${overview}\n\n` +
            `=== АГРЕГИРОВАННЫЕ НАХОДКИ ===\n${JSON.stringify(agg).slice(0, 60000)}`,
        },
      ]);

      const synth = parseJsonLoose(synthContent) as Record<string, unknown>;

      const report = {
        language: trData.language,
        duration_estimate: trData.duration_estimate,
        participants: trData.participants ?? [],
        ...synth,
        transcript,
      };

      await admin
        .from("analyses")
        .update({
          status: "done",
          transcript,
          report: report as never,
        })
        .eq("id", data.analysisId);

      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      console.error("analyzeRecording failed:", message);
      await setStatus("failed", message);
      return { ok: false, error: message };
    }
  });
