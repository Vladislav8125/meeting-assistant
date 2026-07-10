// AI-автоматическая оценка 10 этапов матрицы по загруженным материалам.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MATRIX_STAGES } from "./matrix-config";

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

const MAX_TOTAL_CHARS = 80_000;

async function extractText(filename: string, bytes: Uint8Array): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".csv")) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const buf = Buffer.from(bytes);
    const res = await mammoth.extractRawText({ buffer: buf });
    return res.value || "";
  }
  // PDF / PPTX и прочее — на этом этапе не поддерживаем, возвращаем плейсхолдер
  return `[Файл ${filename}: формат пока не извлекается автоматически. Опишите содержание в поле "Свободный текст".]`;
}

function buildStagesSchema() {
  return MATRIX_STAGES.map(
    (s) =>
      `- ${s.key} ("${s.title}", вес ${s.weight}). Статусы 0..${s.statuses.length - 1}: ${s.statuses
        .map((st, i) => `${i}="${st}"`)
        .join(", ")}. Критерии: ${s.criteria}`,
  ).join("\n");
}

const SYS = `Ты — фасилитатор корпоративных совещаний. Оцени готовность совещания по 10 этапам, опираясь только на предоставленные материалы. Не выдумывай факты — если данных не хватает, ставь низкий статус и пиши это в rationale.

Этапы и критерии:
${buildStagesSchema()}

Дополнительно по каждому этапу постарайся вытащить из текста:
- responsible: ФИО или роль ответственного, если явно упомянут в материалах. Пустая строка, если не указан — не придумывай.
- due_date: дата дедлайна в формате YYYY-MM-DD. Если указана относительно даты совещания — посчитай абсолютную. Пустая строка, если не указана.

Верни СТРОГО JSON без markdown:
{
  "stages": [
    { "key": "goal", "status_index": 0..3, "confidence": 0..1, "rationale": "1-2 предложения, на русском, чем обусловлен статус", "responsible": "ФИО или пусто", "due_date": "YYYY-MM-DD или пусто" },
    ... (ровно 10 объектов, по одному на каждый key из списка выше, в любом порядке)
  ]
}`;

async function callAI(apiKey: string, userContent: string): Promise<string> {
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.ANALYZE_MODEL || "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYS },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    if (resp.status === 429) throw new Error("Лимит AI исчерпан. Попробуйте через минуту.");
    if (resp.status === 402) throw new Error("Закончился баланс OpenRouter.");
    throw new Error(`AI gateway ${resp.status}: ${t.slice(0, 300)}`);
  }
  const ai = await resp.json();
  return ai?.choices?.[0]?.message?.content ?? "{}";
}

const StageOut = z.object({
  key: z.string(),
  status_index: z.number().int().min(0).max(5),
  confidence: z.number().min(0).max(1).optional().default(0.6),
  rationale: z.string().max(500).optional().default(""),
  responsible: z.string().max(200).optional().default(""),
  due_date: z.string().max(20).optional().default(""),
});
const AIOut = z.object({ stages: z.array(StageOut).min(1).max(20) });

function normalizeDate(s: string): string {
  const t = s.trim();
  if (!t) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : "";
}

export const analyzeMatrix = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        preparation_id: z.string().uuid(),
        storage_paths: z.array(z.string().min(1).max(500)).max(10).default([]),
        free_text: z.string().max(30_000).optional().default(""),
        meeting_date: z.string().max(20).optional().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not configured");
    const admin = await getAdmin();

    // Скачать и извлечь тексты
    const parts: string[] = [];
    if (data.meeting_date) {
      parts.push(`### Дата совещания: ${data.meeting_date}`);
    }
    if (data.free_text.trim()) {
      parts.push(`### Свободный текст подготовки\n${data.free_text.trim()}`);
    }
    for (const path of data.storage_paths) {
      try {
        const { data: blob, error } = await admin.storage.from("media").download(path);
        if (error || !blob) {
          parts.push(`### ${path}\n[не удалось скачать: ${error?.message ?? "пусто"}]`);
          continue;
        }
        const buf = new Uint8Array(await blob.arrayBuffer());
        const name = path.split("/").pop() ?? path;
        const text = await extractText(name, buf);
        parts.push(`### ${name}\n${text}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown";
        parts.push(`### ${path}\n[ошибка извлечения: ${msg}]`);
      }
    }

    let userContent = parts.join("\n\n");
    if (!userContent.trim()) {
      return { ok: false as const, error: "Нет ни одного материала или текста для анализа." };
    }
    if (userContent.length > MAX_TOTAL_CHARS) {
      userContent = userContent.slice(0, MAX_TOTAL_CHARS) + "\n\n[…обрезано]";
    }

    try {
      const raw = await callAI(OPENROUTER_API_KEY, userContent);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : {};
      }
      const safe = AIOut.safeParse(parsed);
      if (!safe.success) {
        return { ok: false as const, error: "AI вернул неожиданный формат ответа." };
      }
      // Кламп статусов к допустимым для каждого этапа
      const byKey = new Map(MATRIX_STAGES.map((s) => [s.key, s] as const));
      const cleaned = safe.data.stages
        .filter((s) => byKey.has(s.key))
        .map((s) => {
          const def = byKey.get(s.key)!;
          const idx = Math.max(0, Math.min(def.statuses.length - 1, Math.round(s.status_index)));
          return {
            key: s.key,
            status_index: idx,
            confidence: s.confidence,
            rationale: s.rationale,
            responsible: s.responsible.trim().slice(0, 200),
            due_date: normalizeDate(s.due_date),
          };
        });

      await admin.rpc("append_preparation_log", {
        _id: data.preparation_id,
        _entry: {
          ts: new Date().toISOString(),
          source: "ai",
          level: "info",
          message: "Matrix AI analysis completed",
          data: { files: data.storage_paths.length, stages: cleaned.length },
        } as never,
      });

      return { ok: true as const, stages: cleaned };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      return { ok: false as const, error: msg };
    }
  });
