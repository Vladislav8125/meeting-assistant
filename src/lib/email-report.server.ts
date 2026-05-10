// Server-only: send the analysis report to the recipient via Lovable Emails.
// Requires email infrastructure (email domain + setup_email_infra) to be configured.
// If infra is missing, returns a clear error so the UI can prompt the user.
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAnalysis } from "@/lib/analysis-logs.server";

type Report = {
  summary?: string;
  verdict?: string;
  overall_score?: number;
  language?: string;
  duration_estimate?: string;
  key_points?: string[];
  decisions?: string[];
  action_items?: { task: string; owner?: string; deadline?: string }[];
  recommendations?: string[];
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(opts: {
  title: string;
  reportUrl: string;
  report: Report;
}): string {
  const { title, reportUrl, report } = opts;
  const score = report.overall_score ?? "—";
  const li = (items?: string[]) =>
    items && items.length
      ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
      : "<p style='color:#888'>—</p>";

  return `<!doctype html><html><body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111">
  <h1 style="font-size:22px;margin:0 0 4px">${escapeHtml(title)}</h1>
  <div style="color:#666;font-size:13px;margin-bottom:18px">meetanalize · отчёт</div>
  <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:18px">
    <div style="font-size:34px;font-weight:700">${score}<span style="font-size:14px;color:#888">/100</span></div>
    <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.06em">Общая оценка</div>
  </div>
  ${report.verdict ? `<h2 style="font-size:16px">Вердикт</h2><p>${escapeHtml(report.verdict)}</p>` : ""}
  ${report.summary ? `<p style="color:#444">${escapeHtml(report.summary)}</p>` : ""}
  <h2 style="font-size:16px">Ключевые тезисы</h2>${li(report.key_points)}
  <h2 style="font-size:16px">Принятые решения</h2>${li(report.decisions)}
  ${report.action_items && report.action_items.length ? `<h2 style="font-size:16px">Action items</h2><ul>${report.action_items.map((a) => `<li>${escapeHtml(a.task)}${a.owner ? ` — <b>${escapeHtml(a.owner)}</b>` : ""}${a.deadline ? ` <i>(${escapeHtml(a.deadline)})</i>` : ""}</li>`).join("")}</ul>` : ""}
  <h2 style="font-size:16px">Рекомендации</h2>${li(report.recommendations)}
  <p style="margin-top:24px"><a href="${reportUrl}" style="background:#5b6cff;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Открыть полный отчёт</a></p>
  <p style="color:#999;font-size:12px;margin-top:32px">© ${new Date().getFullYear()} meetanalize · эффективное совещание</p>
  </body></html>`;
}

export async function sendAnalysisReport(
  admin: SupabaseClient,
  analysisId: string,
  recipientEmail: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: row, error } = await admin
      .from("analyses")
      .select("id, file_name, topic, report")
      .eq("id", analysisId)
      .single();
    if (error || !row) throw new Error("Запись не найдена");
    const report = (row.report ?? {}) as Report;
    if (!report || Object.keys(report).length === 0) {
      throw new Error("Отчёт ещё не готов");
    }

    const PROJECT_ID = "e71eef0d-2665-4ba3-ac78-e7a2c5599aac";
    const reportUrl = `https://project--${PROJECT_ID}.lovable.app/analysis/${analysisId}`;
    const subject = `Отчёт: ${row.topic || row.file_name}`;
    const html = renderHtml({
      title: (row.topic as string | null) || (row.file_name as string),
      reportUrl,
      report,
    });

    // Try Lovable Emails queue (requires email infra).
    // Falls back gracefully if RPCs are not present.
    const enq = await admin.rpc("enqueue_email" as never, {
      _queue: "transactional_emails",
      _payload: {
        to: recipientEmail,
        subject,
        html,
        template_name: "analysis-report",
      },
    } as never);

    if (enq.error) {
      const msg = enq.error.message || "email queue недоступен";
      await logAnalysis(admin, analysisId, "email", "error", "enqueue_email failed", msg);
      throw new Error(
        "Email-инфраструктура не настроена. Настройте отправку писем (домен + queue).",
      );
    }

    await admin
      .from("analyses")
      .update({ email_sent_at: new Date().toISOString(), recipient_email: recipientEmail })
      .eq("id", analysisId);
    await logAnalysis(admin, analysisId, "email", "info", "Report queued", {
      to: recipientEmail,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    await logAnalysis(admin, analysisId, "email", "error", "Send failed", msg);
    return { ok: false, error: msg };
  }
}
