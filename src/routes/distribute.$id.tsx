import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useCallback } from "react";
import { TopNav } from "@/components/TopNav";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { sendReport, sendActionItemsToParticipants } from "@/lib/distribute.functions";
import { toast } from "sonner";
import { ArrowLeft, Send, Loader2, Printer, Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/distribute/$id")({
  component: DistributeOne,
});

type Participant = { label: string; role_guess?: string; talk_share_pct?: number };
type Distribution = {
  ts: string;
  kind: string;
  format?: string;
  label?: string;
  to: string;
  count?: number;
  ok: boolean;
  error?: string | null;
};

type Row = {
  id: string;
  file_name: string;
  topic: string | null;
  status: string;
  report: {
    summary?: string;
    overall_score?: number;
    participants?: Participant[];
    action_items?: { task: string; owner?: string }[];
  } | null;
  recipient_email: string | null;
  participant_emails: { label: string; email: string }[];
  distributions: Distribution[];
};

function DistributeOne() {
  const { id } = Route.useParams();
  const [row, setRow] = useState<Row | null>(null);
  const [recipients, setRecipients] = useState<string[]>([""]);
  const [format, setFormat] = useState<"full" | "summary" | "actions">("full");
  const [assignments, setAssignments] = useState<{ label: string; email: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [sendingAI, setSendingAI] = useState(false);

  const sendReportFn = useServerFn(sendReport);
  const sendAIFn = useServerFn(sendActionItemsToParticipants);

  const load = useCallback(() => {
    supabase
      .from("analyses")
      .select("id,file_name,topic,status,report,recipient_email,participant_emails,distributions")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (data) {
          const r = data as unknown as Row;
          setRow(r);
          if (!recipients[0] && r.recipient_email) setRecipients([r.recipient_email]);
          const ppl = r.report?.participants ?? [];
          if (assignments.length === 0 && ppl.length) {
            const existing = r.participant_emails ?? [];
            setAssignments(
              ppl.map((p) => ({
                label: p.label,
                email: existing.find((e) => e.label === p.label)?.email ?? "",
              })),
            );
          }
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const doSend = async () => {
    const clean = recipients.map((r) => r.trim()).filter(Boolean);
    if (!clean.length) {
      toast.error("Укажите хотя бы один email");
      return;
    }
    setSending(true);
    try {
      const res = await sendReportFn({ data: { analysisId: id, recipients: clean, format } });
      if (res.ok) toast.success(`Отправлено: ${clean.length}`);
      else toast.error(res.results.find((r) => !r.ok)?.error || "Ошибка отправки");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSending(false);
    }
  };

  const doSendAI = async () => {
    const clean = assignments.filter((a) => a.label && a.email.trim());
    if (!clean.length) {
      toast.error("Заполните email хотя бы одного участника");
      return;
    }
    setSendingAI(true);
    try {
      const res = await sendAIFn({ data: { analysisId: id, assignments: clean } });
      if (res.ok) toast.success(`Action items отправлены: ${clean.length}`);
      else toast.error("Часть писем не ушла, проверьте лог");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSendingAI(false);
    }
  };

  if (!row) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <TopNav />
        <main className="flex-1 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </main>
        <Footer />
      </div>
    );
  }

  const title = row.topic || row.file_name;
  const printUrl = `/analysis/${id}`;

  return (
    <div className="min-h-screen flex flex-col bg-background relative">
      <TopNav />
      <main className="relative z-10 max-w-5xl mx-auto px-6 pt-10 pb-24 w-full flex-1">
        <Link to="/distribute" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> К списку рассылок
        </Link>
        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-xs text-muted-foreground">Шаг 3 · Рассылка</div>
            <h1 className="font-display text-3xl font-semibold">{title}</h1>
            {row.report?.overall_score != null && (
              <div className="mt-2 text-sm text-muted-foreground">
                Общая оценка: <b className="text-foreground">{row.report.overall_score}/100</b>
              </div>
            )}
          </div>
          <a
            href={printUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card hover:bg-accent/40 px-3 py-2 text-sm font-mono"
          >
            <Printer className="h-4 w-4" /> Печать / PDF
          </a>
        </div>

        {/* Block A: Send report to recipients */}
        <section className="mt-10 rounded-2xl border border-border bg-card/60 p-6">
          <div className="font-display text-xl mb-1">Отправить отчёт</div>
          <p className="text-sm text-muted-foreground mb-4">
            Несколько получателей · выбор формата
          </p>

          <div className="space-y-2">
            {recipients.map((r, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="email"
                  className="flex-1 rounded-lg bg-input/40 border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/60"
                  placeholder="email@example.com"
                  value={r}
                  onChange={(e) => {
                    const next = [...recipients];
                    next[i] = e.target.value;
                    setRecipients(next);
                  }}
                  maxLength={200}
                />
                <button
                  type="button"
                  onClick={() => setRecipients(recipients.filter((_, j) => j !== i))}
                  disabled={recipients.length === 1}
                  className="rounded-md border border-border px-2 text-muted-foreground hover:text-destructive disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRecipients([...recipients, ""])}
              className="inline-flex items-center gap-1.5 text-xs font-mono text-brand hover:underline"
            >
              <Plus className="h-3 w-3" /> Добавить получателя
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(["full", "summary", "actions"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                className={`rounded-md border px-3 py-1.5 text-xs font-mono transition ${
                  format === f
                    ? "border-brand/60 bg-brand/15 text-brand"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {f === "full" ? "Полный отчёт" : f === "summary" ? "Резюме" : "Только action items"}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={doSend}
            disabled={sending}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand text-brand-foreground font-semibold px-4 py-2.5 hover:opacity-95 disabled:opacity-50 transition"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Отправить
          </button>
        </section>

        {/* Block B: Personal action items per participant */}
        {assignments.length > 0 && (
          <section className="mt-6 rounded-2xl border border-border bg-card/60 p-6">
            <div className="font-display text-xl mb-1">Action items участникам</div>
            <p className="text-sm text-muted-foreground mb-4">
              Каждому участнику — его задачи, отфильтрованные по имени.
            </p>
            <div className="space-y-2">
              {assignments.map((a, i) => (
                <div key={i} className="grid sm:grid-cols-[1fr,1.2fr] gap-2">
                  <input
                    className="rounded-lg bg-input/40 border border-border px-3 py-2 text-sm"
                    value={a.label}
                    onChange={(e) => {
                      const next = [...assignments];
                      next[i] = { ...next[i], label: e.target.value };
                      setAssignments(next);
                    }}
                    maxLength={200}
                  />
                  <input
                    type="email"
                    placeholder="email@example.com"
                    className="rounded-lg bg-input/40 border border-border px-3 py-2 text-sm"
                    value={a.email}
                    onChange={(e) => {
                      const next = [...assignments];
                      next[i] = { ...next[i], email: e.target.value };
                      setAssignments(next);
                    }}
                    maxLength={200}
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={doSendAI}
              disabled={sendingAI}
              className="mt-5 inline-flex items-center gap-2 rounded-lg border border-brand/40 bg-brand/10 text-brand font-semibold px-4 py-2.5 hover:bg-brand/20 disabled:opacity-50 transition"
            >
              {sendingAI ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Разослать персонально
            </button>
          </section>
        )}

        {/* History */}
        {row.distributions && row.distributions.length > 0 && (
          <section className="mt-6 rounded-2xl border border-border bg-card/40 p-6">
            <div className="font-display text-lg mb-3">История отправок</div>
            <div className="space-y-1.5">
              {row.distributions.slice().reverse().map((d, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 text-xs font-mono rounded-md border border-border bg-background/60 px-3 py-2"
                >
                  <span className={d.ok ? "text-success" : "text-destructive"}>
                    {d.ok ? "✓" : "✗"}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(d.ts).toLocaleTimeString("ru-RU")}
                  </span>
                  <span className="font-medium text-foreground">
                    {d.kind === "report" ? `report · ${d.format}` : "action_items"}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="truncate">{d.to}</span>
                  {d.count != null && (
                    <span className="text-muted-foreground">({d.count} задач)</span>
                  )}
                  {d.error && <span className="text-destructive truncate">{d.error}</span>}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
