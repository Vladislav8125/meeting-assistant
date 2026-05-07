import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const SYSTEM_PROMPT = `Ты — эксперт по эффективности деловых совещаний. Анализируй приложенную аудио/видео-запись по методике "16 правил успешного совещания".

Твоя задача — вернуть СТРОГО валидный JSON без markdown-обёрток и комментариев, со следующей структурой:

{
  "language": "ru" | "en" | "other",
  "duration_estimate": "строка вида '12 мин' или 'неизвестно'",
  "summary": "краткое резюме 2-4 предложения",
  "goal": {
    "stated": "цель встречи как она прозвучала, или 'не сформулирована'",
    "clarity_score": 0-10,
    "comment": "почему такая оценка"
  },
  "participants": [{ "label": "Спикер 1", "role_guess": "роль/функция", "talk_share_pct": 0-100 }],
  "transcript": "полная транскрипция с разметкой [Спикер 1]: ... [Спикер 2]: ...",
  "key_points": ["ключевой тезис 1", "..."],
  "decisions": ["принятое решение 1", "..."],
  "action_items": [{ "task": "что", "owner": "кто", "deadline": "когда или '—'" }],
  "questions_objections": ["вопрос/возражение 1", "..."],
  "risks": ["риск 1", "..."],
  "rules_assessment": [
    { "id": 1, "title": "Определи цель", "score": 0-10, "evidence": "цитата/факт", "recommendation": "что улучшить" },
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
  "verdict": "1-2 предложения общего вердикта",
  "recommendations": ["главная рекомендация 1", "..."]
}

Если запись пустая, нерелевантная или нечитаемая — верни JSON с status:"unreadable" в поле verdict и оценкой 0.
Отвечай на языке записи (русский по умолчанию).`;

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

    await admin
      .from("analyses")
      .update({ status: "processing", error: null })
      .eq("id", data.analysisId);

    try {
      // Download file and convert to base64 for Gemini multimodal
      const fileResp = await fetch(data.publicUrl);
      if (!fileResp.ok)
        throw new Error(`Failed to fetch media: ${fileResp.status}`);
      const buf = new Uint8Array(await fileResp.arrayBuffer());

      // Cloudflare Workers: Buffer is available with nodejs_compat
      const base64 = Buffer.from(buf).toString("base64");

      const userText = [
        data.topic ? `Тема встречи: ${data.topic}` : null,
        data.participants ? `Участники: ${data.participants}` : null,
        "Проанализируй эту запись и верни JSON по заданной схеме.",
      ]
        .filter(Boolean)
        .join("\n");

      const aiResp = await fetch(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: [
                  { type: "text", text: userText },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${data.mimeType};base64,${base64}`,
                    },
                  },
                ],
              },
            ],
            response_format: { type: "json_object" },
          }),
        },
      );

      if (!aiResp.ok) {
        const t = await aiResp.text();
        if (aiResp.status === 429)
          throw new Error("Превышен лимит запросов. Попробуйте позже.");
        if (aiResp.status === 402)
          throw new Error(
            "Закончился баланс Lovable AI. Пополните в настройках workspace.",
          );
        throw new Error(`AI gateway ${aiResp.status}: ${t.slice(0, 300)}`);
      }

      const ai = await aiResp.json();
      const content = ai?.choices?.[0]?.message?.content;
      if (!content) throw new Error("Пустой ответ от модели");

      let report: unknown;
      try {
        report = JSON.parse(content);
      } catch {
        const m = content.match(/\{[\s\S]*\}/);
        if (!m) throw new Error("Не удалось распарсить JSON-ответ модели");
        report = JSON.parse(m[0]);
      }

      const transcript =
        (report as { transcript?: string })?.transcript ?? null;

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
      await admin
        .from("analyses")
        .update({ status: "failed", error: message })
        .eq("id", data.analysisId);
      return { ok: false, error: message };
    }
  });
