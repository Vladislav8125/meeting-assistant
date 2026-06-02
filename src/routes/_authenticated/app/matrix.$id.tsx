import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Save, Loader2, FileDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  MATRIX_STAGES,
  type MatrixStage,
  summarizeMatrix,
  stageScorePct,
  isBlocking,
} from "@/lib/matrix-config";
import { downloadMatrixPdf } from "@/lib/pdf-export";

export const Route = createFileRoute("/_authenticated/app/matrix/$id")({
  component: MatrixDetail,
});

type Row = {
  id: string;
  topic: string;
  meeting_date: string | null;
  moderator: string | null;
  stages: MatrixStage[];
};

function MatrixDetail() {
  const { id } = Route.useParams();
  const [row, setRow] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("meeting_preparations")
      .select("id,topic,meeting_date,moderator,stages")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => setRow(data as Row | null));
  }, [id]);

  const summary = useMemo(() => (row ? summarizeMatrix(row.stages) : null), [row]);

  if (!row || !summary) {
    return (
      <div className="p-8 text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
      </div>
    );
  }

  const setStage = (i: number, patch: Partial<MatrixStage>) =>
    setRow((r) => (r ? { ...r, stages: r.stages.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) } : r));

  const save = async () => {
    setSaving(true);
    const sum = summarizeMatrix(row.stages);
    const { error } = await supabase
      .from("meeting_preparations")
      .update({
        topic: row.topic,
        meeting_date: row.meeting_date || null,
        moderator: row.moderator,
        stages: row.stages as never,
        ...sum,
      })
      .eq("id", id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Сохранено · " + sum.readiness_percent + "%");
  };

  const remove = async () => {
    if (!confirm("Удалить запись подготовки?")) return;
    await supabase.from("meeting_preparations").delete().eq("id", id);
    window.location.href = "/app/matrix";
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <Link to="/app/matrix" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> К списку
      </Link>

      <div className="mt-4 grid lg:grid-cols-[1fr_280px] gap-6 items-start">
        <div>
          <input
            value={row.topic}
            onChange={(e) => setRow({ ...row, topic: e.target.value })}
            className="w-full font-display text-2xl bg-transparent border-b border-border focus:outline-none focus:border-brand pb-1"
            maxLength={500}
          />
          <div className="mt-3 grid sm:grid-cols-3 gap-2">
            <input
              type="date"
              value={row.meeting_date ?? ""}
              onChange={(e) => setRow({ ...row, meeting_date: e.target.value || null })}
              className="rounded-lg bg-input/40 border border-border px-3 py-2 text-sm"
            />
            <input
              placeholder="Модератор / инициатор"
              value={row.moderator ?? ""}
              onChange={(e) => setRow({ ...row, moderator: e.target.value })}
              className="sm:col-span-2 rounded-lg bg-input/40 border border-border px-3 py-2 text-sm"
              maxLength={200}
            />
          </div>
        </div>
        <aside className="rounded-2xl border border-border bg-card/60 p-5 text-center">
          <div
            className={`font-display text-5xl font-semibold ${
              summary.readiness_percent >= 85
                ? "text-success"
                : summary.readiness_percent >= 60
                ? "text-warn"
                : "text-destructive"
            }`}
          >
            {summary.readiness_percent}<span className="text-xl text-muted-foreground">%</span>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Готовность</div>
          <div className="text-xs mt-2">
            Блокирующих: <b className={summary.blocking_count > 0 ? "text-destructive" : ""}>{summary.blocking_count}</b>
          </div>
          <div className="mt-2 font-mono text-[11px]">{summary.verdict_label}</div>
          <div className="mt-4 grid gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand text-brand-foreground px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Сохранить
            </button>
            <button
              onClick={() => downloadMatrixPdf({ ...row, ...summary })}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card hover:bg-accent/40 px-3 py-2 text-sm"
            >
              <FileDown className="h-4 w-4" /> Скачать PDF
            </button>
            <button
              onClick={remove}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 px-3 py-2 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" /> Удалить
            </button>
          </div>
        </aside>
      </div>

      <section className="mt-8 rounded-2xl border border-border bg-card/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-background/50 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Этап</th>
              <th className="px-3 py-2 w-56">Статус</th>
              <th className="px-3 py-2">Ответственный</th>
              <th className="px-3 py-2 w-36">Срок</th>
              <th className="px-3 py-2">Комментарий</th>
              <th className="px-3 py-2 text-right">Вес · Оценка</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {row.stages.map((s, i) => {
              const def = MATRIX_STAGES.find((d) => d.key === s.key)!;
              const pct = stageScorePct(s.key, s.status_index);
              const blocking = isBlocking(s.key, s.status_index);
              return (
                <tr key={s.key} className={blocking ? "bg-destructive/5" : ""}>
                  <td className="px-3 py-2 font-medium">{s.title}</td>
                  <td className="px-3 py-2">
                    <select
                      value={s.status_index}
                      onChange={(e) => setStage(i, { status_index: Number(e.target.value) })}
                      className="w-full rounded-md bg-input/40 border border-border px-2 py-1.5 text-sm"
                    >
                      {def.statuses.map((st, idx) => (
                        <option key={idx} value={idx}>{st}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={s.responsible}
                      onChange={(e) => setStage(i, { responsible: e.target.value })}
                      className="w-full rounded-md bg-input/40 border border-border px-2 py-1.5 text-sm"
                      maxLength={200}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="date"
                      value={s.due_date}
                      onChange={(e) => setStage(i, { due_date: e.target.value })}
                      className="w-full rounded-md bg-input/40 border border-border px-2 py-1.5 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={s.comment}
                      onChange={(e) => setStage(i, { comment: e.target.value })}
                      className="w-full rounded-md bg-input/40 border border-border px-2 py-1.5 text-sm"
                      maxLength={500}
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {s.weight} · <span className={pct >= 85 ? "text-success" : pct >= 50 ? "text-warn" : "text-destructive"}>{pct}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
