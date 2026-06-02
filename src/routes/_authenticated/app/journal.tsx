import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BookOpen, FileDown, Loader2 } from "lucide-react";
import { downloadJournalCsv } from "@/lib/pdf-export";

export const Route = createFileRoute("/_authenticated/app/journal")({
  component: JournalPage,
});

type JournalRow = {
  kind: "checklist" | "matrix" | "analysis";
  id: string;
  date: string; // ISO
  topic: string;
  moderator: string | null;
  readiness: number | null;
  checklist_score: number | null;
  analysis_score: number | null;
  status: string;
  language: string | null;
  link: { to: string; params: Record<string, string> };
};

function JournalPage() {
  const [rows, setRows] = useState<JournalRow[] | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [lang, setLang] = useState("");
  const [minScore, setMinScore] = useState("");

  useEffect(() => {
    const load = async () => {
      const [cl, mt, an] = await Promise.all([
        supabase.from("meeting_checklists").select("id,topic,moderator,score,created_at,meeting_date"),
        supabase.from("meeting_preparations").select("id,topic,moderator,readiness_percent,created_at,meeting_date,verdict_label"),
        supabase.from("analyses").select("id,topic,file_name,status,language,report,created_at"),
      ]);
      const out: JournalRow[] = [];
      (cl.data ?? []).forEach((r: { id: string; topic: string; moderator: string | null; score: number | null; created_at: string; meeting_date: string | null }) =>
        out.push({
          kind: "checklist",
          id: r.id,
          date: r.meeting_date || r.created_at,
          topic: r.topic,
          moderator: r.moderator,
          readiness: null,
          checklist_score: r.score,
          analysis_score: null,
          status: "checklist",
          language: null,
          link: { to: "/app/checklist/$id", params: { id: r.id } },
        }),
      );
      (mt.data ?? []).forEach((r: { id: string; topic: string; moderator: string | null; readiness_percent: number | null; created_at: string; meeting_date: string | null; verdict_label: string | null }) =>
        out.push({
          kind: "matrix",
          id: r.id,
          date: r.meeting_date || r.created_at,
          topic: r.topic,
          moderator: r.moderator,
          readiness: r.readiness_percent,
          checklist_score: null,
          analysis_score: null,
          status: r.verdict_label || "matrix",
          language: null,
          link: { to: "/app/matrix/$id", params: { id: r.id } },
        }),
      );
      type ARow = { id: string; topic: string | null; file_name: string; status: string; language: string | null; report: { overall_score?: number } | null; created_at: string };
      (an.data as ARow[] | null ?? []).forEach((r) =>
        out.push({
          kind: "analysis",
          id: r.id,
          date: r.created_at,
          topic: r.topic || r.file_name,
          moderator: null,
          readiness: null,
          checklist_score: null,
          analysis_score: r.report?.overall_score ?? null,
          status: r.status,
          language: r.language,
          link: { to: "/app/meeting/$id", params: { id: r.id } },
        }),
      );
      out.sort((a, b) => +new Date(b.date) - +new Date(a.date));
      setRows(out);
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const m = Number(minScore) || 0;
    return rows.filter((r) => {
      if (from && new Date(r.date) < new Date(from)) return false;
      if (to && new Date(r.date) > new Date(to + "T23:59:59")) return false;
      if (status && r.status !== status) return false;
      if (lang && (r.language ?? "") !== lang) return false;
      if (m) {
        const sc = r.analysis_score ?? r.checklist_score ?? r.readiness ?? 0;
        if (sc < m) return false;
      }
      return true;
    });
  }, [rows, from, to, status, lang, minScore]);

  const exportCsv = () => {
    downloadJournalCsv(
      filtered.map((r) => ({
        Тип: r.kind,
        Дата: new Date(r.date).toLocaleDateString("ru-RU"),
        Тема: r.topic,
        Модератор: r.moderator ?? "",
        "Готовность %": r.readiness ?? "",
        "Чек-лист %": r.checklist_score ?? "",
        "Анализ /100": r.analysis_score ?? "",
        Статус: r.status,
        Язык: r.language ?? "",
      })),
    );
  };

  const statuses = useMemo(() => Array.from(new Set((rows ?? []).map((r) => r.status))).filter(Boolean), [rows]);
  const langs = useMemo(() => Array.from(new Set((rows ?? []).map((r) => r.language ?? ""))).filter(Boolean), [rows]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="h-10 w-10 rounded-lg bg-accent-2/15 text-accent-2 flex items-center justify-center">
          <BookOpen className="h-5 w-5" />
        </div>
        <div>
          <div className="font-mono text-xs text-muted-foreground">Архив</div>
          <h1 className="font-display text-3xl font-semibold">Все совещания</h1>
        </div>
      </div>
      <p className="text-muted-foreground max-w-2xl">
        Объединённый журнал по чек-листам, подготовкам и анализам записей.
      </p>

      <div className="mt-6 rounded-2xl border border-border bg-card/60 p-4 grid sm:grid-cols-2 lg:grid-cols-6 gap-2 items-center">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg bg-input/40 border border-border px-3 py-2 text-sm" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg bg-input/40 border border-border px-3 py-2 text-sm" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg bg-input/40 border border-border px-3 py-2 text-sm">
          <option value="">Все статусы</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded-lg bg-input/40 border border-border px-3 py-2 text-sm">
          <option value="">Все языки</option>
          {langs.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <input
          type="number" min={0} max={100}
          placeholder="Мин. оценка"
          value={minScore}
          onChange={(e) => setMinScore(e.target.value)}
          className="rounded-lg bg-input/40 border border-border px-3 py-2 text-sm"
        />
        <button onClick={exportCsv} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand text-brand-foreground px-3 py-2 text-sm font-medium">
          <FileDown className="h-4 w-4" /> Экспорт CSV
        </button>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card/60 overflow-hidden">
        {rows == null ? (
          <div className="p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">Совещаний нет — создайте чек-лист, матрицу или загрузите запись.</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Тип</th>
                  <th className="px-3 py-2">Дата</th>
                  <th className="px-3 py-2">Тема</th>
                  <th className="px-3 py-2">Модератор</th>
                  <th className="px-3 py-2 text-right">Готовность</th>
                  <th className="px-3 py-2 text-right">Чек-лист</th>
                  <th className="px-3 py-2 text-right">Анализ</th>
                  <th className="px-3 py-2">Статус</th>
                  <th className="px-3 py-2">Язык</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => (
                  <tr key={r.kind + r.id} className="hover:bg-background/40">
                    <td className="px-3 py-2"><KindPill k={r.kind} /></td>
                    <td className="px-3 py-2 font-mono text-xs">{new Date(r.date).toLocaleDateString("ru-RU")}</td>
                    <td className="px-3 py-2 max-w-xs truncate">{r.topic}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.moderator ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.readiness != null ? r.readiness + "%" : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.checklist_score != null ? r.checklist_score + "%" : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.analysis_score != null ? r.analysis_score + "/100" : "—"}</td>
                    <td className="px-3 py-2 text-xs">{r.status}</td>
                    <td className="px-3 py-2 text-xs font-mono">{r.language ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <Link to={r.link.to} params={r.link.params} className="text-brand hover:underline text-xs">Открыть →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function KindPill({ k }: { k: "checklist" | "matrix" | "analysis" }) {
  const map = {
    checklist: { label: "Чек-лист", cls: "bg-brand/15 text-brand" },
    matrix: { label: "Матрица", cls: "bg-accent-2/15 text-accent-2" },
    analysis: { label: "Анализ", cls: "bg-success/15 text-success" },
  } as const;
  const m = map[k];
  return <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${m.cls}`}>{m.label}</span>;
}
