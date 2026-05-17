// Server fn: AI readiness check for meeting preparation.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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

const SYS = `Ты — фасилитатор. Оцени готовность к деловому совещанию по 16 правилам успешного совещания.
Учитывай: 1) Цель ясно сформулирована, 2) Определены участники и ответственные, 3) Подготовлена структура (сверху вниз), 4) Есть письменные материалы, 5) Учтены вопросы/возражения, 6) Есть предлагаемое решение, 7) Подготовка достаточна, 8) Дано время на обдумывание, 9) Все участники готовятся, 10-16) — могут не оцениваться до встречи.
Верни СТРОГО JSON:
{
  "readiness_score": 0-100,
  "verdict": "1-2 предложения",
  "checks": [{ "id": 1, "title": "Цель", "ok": true|false, "comment": "..." }],
  "recommendations": ["..."],
  "missing": ["чего не хватает"]
}`;

async function callAI(apiKey: string, userContent: string): Promise<string> {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYS },
        { role: "user", content: userContent },
      ],
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
  return ai?.choices?.[0]?.message?.content ?? "{}";
}

export const runReadinessCheck = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ preparationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const admin = await getAdmin();
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const { data: prep, error } = await admin
      .from("meeting_preparations")
      .select("*")
      .eq("id", data.preparationId)
      .single();
    if (error || !prep) return { ok: false, error: "Не найдено" };

    await admin
      .from("meeting_preparations")
      .update({ status: "checking" })
      .eq("id", data.preparationId);

    const materials = (prep.materials as { name: string; size?: number }[]) ?? [];
    const userContent = [
      `Тема: ${prep.topic}`,
      `Цель: ${prep.goal || "(не указана)"}`,
      `Повестка: ${prep.agenda || "(не указана)"}`,
      `Участники: ${prep.participants || "(не указаны)"}`,
      `Ожидаемое решение: ${prep.expected_decision || "(не указано)"}`,
      `Прикреплённых материалов: ${materials.length}${materials.length ? " — " + materials.map((m) => m.name).join(", ") : ""}`,
    ].join("\n");

    try {
      const raw = await callAI(LOVABLE_API_KEY, userContent);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      }

      const score = Number(parsed.readiness_score);
      await admin
        .from("meeting_preparations")
        .update({
          readiness_score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
          verdict: (parsed.verdict as string) ?? null,
          checks: (parsed.checks ?? null) as never,
          recommendations: (parsed.recommendations ?? null) as never,
          status: "checked",
        })
        .eq("id", data.preparationId);

      await admin.rpc("append_preparation_log", {
        _id: data.preparationId,
        _entry: {
          ts: new Date().toISOString(),
          source: "ai",
          level: "info",
          message: "Readiness check completed",
          data: { score },
        } as never,
      });

      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      await admin
        .from("meeting_preparations")
        .update({ status: "draft" })
        .eq("id", data.preparationId);
      await admin.rpc("append_preparation_log", {
        _id: data.preparationId,
        _entry: {
          ts: new Date().toISOString(),
          source: "ai",
          level: "error",
          message: "Readiness check failed",
          data: msg,
        } as never,
      });
      return { ok: false, error: msg };
    }
  });
