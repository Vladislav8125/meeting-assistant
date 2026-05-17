// Server-only: send the analysis report to recipients via Lovable Emails queue.
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAnalysis } from "@/lib/analysis-logs.server";

type ActionItem = { task: string; owner?: string; deadline?: string };

type Report = {
  summary?: string;
  verdict?: string;
  overall_score?: number;
  language?: string;
  duration_estimate?: string;
  key_points?: string[];
  decisions?: string[];
  action_items?: ActionItem[];
  recommendations?: string[];
};

export type ReportFormat = "full" | "summary" | "actions";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ul(items?: string[]) {
  return items && items.length
    ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
    : "<p style='color:#888'>—</p>";
}

function actionsList(items?: ActionItem[]) {
  if (!items || !items.length) return "<p style='color:#888'>—</p>";
  return `<ul>${items
    .map(
      (a) =>
        `<li>${escapeHtml(a.task)}${a.owner ? ` — <b>${escapeHtml(a.owner)}</b>` : ""}${a.deadline ? ` <i>(${escapeHtml(a.deadline)})</i>` : ""}</li>`,
    )
    .join("")}</ul>`;
}

function shell(inner: string, title: string, reportUrl: string) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111">
  <h1 style="font-size:22px;margin:0 0 4px">${escapeHtml(title)}</h1>
  <div style="color:#666;font-size:13px;margin-bottom:18px">meetanalize · отчёт</div>
  ${inner}
  <p style="margin-top:24px"><a href="${reportUrl}" style="background:#5b6cff;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Открыть полный отчёт</a></p>
  <p style="color:#999;font-size:12px;margin-top:32px">© ${new Date().getFullYear()} meetanalize · эффективное совещание</p>
  </body></html>`;
}

function renderFull(report: Report) {
  const score = report.overall_score ?? "—";
  return `
  <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:18px">
    <div style="font-size:34px;font-weight:700">${score}<span style="font-size:14px;color:#888">/100</span></div>
    <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.06em">Общая оценка</div>
  </div>
  ${report.verdict ? `<h2 style="font-size:16px">Вердикт</h2><p>${escapeHtml(report.verdict)}</p>` : ""}
  ${report.summary ? `<p style="color:#444">${escapeHtml(report.summary)}</p>` : ""}
  <h2 style="font-size:16px">Ключевые тезисы</h2>${ul(report.key_points)}
  <h2 style="font-size:16px">Принятые решения</h2>${ul(report.decisions)}
  <h2 style="font-size:16px">Action items</h2>${actionsList(report.action_items)}
  <h2 style="font-size:16px">Рекомендации</h2>${ul(report.recommendations)}`;
}

function renderSummary(report: Report) {
  const score = report.overall_score ?? "—";
  return `
  <div style="border:1px solid #eee;border-radius:12px;padding:16px;margin-bottom:18px">
    <div style="font-size:34px;font-weight:700">${score}<span style="font-size:14px;color:#888">/100</span></div>
    <div style="font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.06em">Общая оценка</div>
  </div>
  ${report.verdict ? `<h2 style="font-size:16px">Вердикт</h2><p>${escapeHtml(report.verdict)}</p>` : ""}
  ${report.summary ? `<p style="color:#444">${escapeHtml(report.summary)}</p>` : ""}
  <h2 style="font-size:16px">Главные решения</h2>${ul(report.decisions)}`;
}

function renderActions(items: ActionItem[]) {
  return `<h2 style="font-size:16px">Action items</h2>${actionsList(items)}`;
}

export async function sendAnalysisReport(
  admin: SupabaseClient,
  analysisId: string,
  recipientEmail: string,
  format: ReportFormat = "full",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: row, error } = await admin
      .from("analyses")
      .select("id, file_name, topic, report")
      .eq("id", analysisId)
      .single();
    if (error || !row) throw new Error("Запись не найдена");
    const report = (row.report ?? {}) as Report;
    if (!report || Object.keys(report).length === 0) throw new Error("Отчёт ещё не готов");

    const PROJECT_ID = "e71eef0d-2665-4ba3-ac78-e7a2c5599aac";
    const reportUrl = `https://project--${PROJECT_ID}.lovable.app/analysis/${analysisId}`;
    const title = (row.topic as string | null) || (row.file_name as string);
    const subjectPrefix =
      format === "summary" ? "Резюме" : format === "actions" ? "Action items" : "Отчёт";
    const subject = `${subjectPrefix}: ${title}`;
    const body =
      format === "summary"
        ? renderSummary(report)
        : format === "actions"
          ? renderActions(report.action_items ?? [])
          : renderFull(report);
    const html = shell(body, title, reportUrl);

    const enq = await admin.rpc("enqueue_email" as never, {
      _queue: "transactional_emails",
      _payload: {
        to: recipientEmail,
        subject,
        html,
        template_name: `analysis-${format}`,
      },
    } as never);
    if (enq.error) {
      const msg = enq.error.message || "email queue недоступен";
      await logAnalysis(admin, analysisId, "email", "error", "enqueue_email failed", msg);
      throw new Error("Email-инфраструктура не настроена. Настройте отправку писем.");
    }

    if (format === "full") {
      await admin
        .from("analyses")
        .update({ email_sent_at: new Date().toISOString(), recipient_email: recipientEmail })
        .eq("id", analysisId);
    }
    await logAnalysis(admin, analysisId, "email", "info", "Report queued", { to: recipientEmail, format });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    await logAnalysis(admin, analysisId, "email", "error", "Send failed", msg);
    return { ok: false, error: msg };
  }
}

// Send only action items assigned to a specific participant by name match.
export async function sendActionItemsEmail(
  admin: SupabaseClient,
  analysisId: string,
  participantLabel: string,
  recipientEmail: string,
): Promise<{ ok: boolean; error?: string; count?: number }> {
  try {
    const { data: row, error } = await admin
      .from("analyses")
      .select("id, file_name, topic, report")
      .eq("id", analysisId)
      .single();
    if (error || !row) throw new Error("Запись не найдена");
    const report = (row.report ?? {}) as Report;
    const all = report.action_items ?? [];
    const needle = participantLabel.toLowerCase();
    const mine = all.filter(
      (a) => (a.owner ?? "").toLowerCase().includes(needle),
    );

    const PROJECT_ID = "e71eef0d-2665-4ba3-ac78-e7a2c5599aac";
    const reportUrl = `https://project--${PROJECT_ID}.lovable.app/analysis/${analysisId}`;
    const title = (row.topic as string | null) || (row.file_name as string);
    const subject = `Ваши задачи по совещанию: ${title}`;
    const inner = `
      <p style="color:#444">Здравствуйте, ${escapeHtml(participantLabel)}! Ниже задачи, закреплённые за вами по итогам совещания.</p>
      ${mine.length ? actionsList(mine) : "<p style='color:#888'>Персональных задач не зафиксировано. Загляните в полный отчёт.</p>"}`;
    const html = shell(inner, title, reportUrl);

    const enq = await admin.rpc("enqueue_email" as never, {
      _queue: "transactional_emails",
      _payload: {
        to: recipientEmail,
        subject,
        html,
        template_name: "action-items-personal",
      },
    } as never);
    if (enq.error) {
      throw new Error("Email-инфраструктура не настроена. Настройте отправку писем.");
    }
    await logAnalysis(admin, analysisId, "email", "info", "Action items queued", {
      to: recipientEmail,
      label: participantLabel,
      count: mine.length,
    });
    return { ok: true, count: mine.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    await logAnalysis(admin, analysisId, "email", "error", "Action items send failed", msg);
    return { ok: false, error: msg };
  }
}
