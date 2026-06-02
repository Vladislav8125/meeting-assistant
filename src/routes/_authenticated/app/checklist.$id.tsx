import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Save, Loader2, FileDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { type ChecklistItem, computeScore } from "@/lib/checklist-config";
import { downloadChecklistPdf } from "@/lib/pdf-export";

export const Route = createFileRoute("/_authenticated/app/checklist/$id")({
  component: ChecklistDetail,
});

type Row = {
  id: string;
  topic: string;
  meeting_date: string | null;
  moderator: string | null;
  notes: string | null;
  items: ChecklistItem[];
  score: number | null;
};

function ChecklistDetail() {
  const { id } = Route.useParams();
  const [row, setRow] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("meeting_checklists")
      .select("id,topic,meeting_date,moderator,notes,items,score")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => setRow(data as Row | null));
  }, [id]);

  const score = useMemo(() => (row ? computeScore(row.items) : 0), [row]);

  const setField = <K extends keyof Row>(k: K, v: Row[K]) =>
    setRow((r) => (r ? { ...r, [k]: v } : r));

  const toggle = (idx: number) =>
    setRow((r) => {
      if (!r) return r;
      const items = r.items.map((it, i) => (i === idx ? { ...it, done: !it.done } : it));
      return { ...r, items };
    });

  const save = async () => {
    if (!row) return;
    setSaving(true);
    const { error } = await supabase
      .from("meeting_checklists")
      .update({
        topic: row.topic,
        meeting_date: row.meeting_date || null,
        moderator: row.moderator,
        notes: row.notes,
        items: row.items as never,
        score,
      })
      .eq("id", id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Сохранено · " + score + "%");
  };

  const remove = async () => {
    if (!confirm("Удалить чек-лист?")) return;
    await supabase.from("meeting_checklists").delete().eq("id", id);
    window.location.href = "/app/checklist";
  };

  if (!row) {
    return (
      <div className="p-8 text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
      </div>
    );
  }

  // group by rule_no
  const groups = new Map<number, { title: string; items: { item: ChecklistItem; idx: number }[] }>();
  row.items.forEach((it, idx) => {
    if (!groups.has(it.rule_no)) groups.set(it.rule_no, { title: it.rule_title, items: [] });
    groups.get(it.rule_no)!.items.push({ item: it, idx });
  });

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <Link to="/app/checklist" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> К списку
      </Link>

      <div className="mt-4 grid lg:grid-cols-[1fr_280px] gap-6 items-start">
        <div>
          <input
            value={row.topic}
            onChange={(e) => setField("topic", e.target.value)}
            className="w-full font-display text-2xl bg-transparent border-b border-border focus:outline-none focus:border-brand pb-1"
            maxLength={500}
          />
          <div className="mt-3 grid sm:grid-cols-3 gap-2">
            <input
              type="date"
              value={row.meeting_date ?? ""}
              onChange={(e) => setField("meeting_date", e.target.value || null)}
              className="rounded-lg bg-input/40 border border-border px-3 py-2 text-sm"
            />
            <input
              placeholder="Модератор / инициатор"
              value={row.moderator ?? ""}
              onChange={(e) => setField("moderator", e.target.value)}
              className="sm:col-span-2 rounded-lg bg-input/40 border border-border px-3 py-2 text-sm"
              maxLength={200}
            />
          </div>
        </div>
        <aside className="rounded-2xl border border-border bg-card/60 p-5 text-center">
          <div
            className={`font-display text-5xl font-semibold ${
              score >= 75 ? "text-success" : score >= 50 ? "text-warn" : "text-destructive"
            }`}
          >
            {score}<span className="text-xl text-muted-foreground">%</span>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Оценка</div>
          <div className="text-xs text-muted-foreground mt-2">
            Выполнено: {row.items.filter((i) => i.done).length} / {row.items.length}
          </div>
          <div className="mt-4 grid gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand text-brand-foreground px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Сохранить
            </button>
            <button
              onClick={() => downloadChecklistPdf({ ...row, score })}
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

      <section className="mt-8 space-y-4">
        {Array.from(groups.entries()).map(([no, g]) => (
          <div key={no} className="rounded-2xl border border-border bg-card/60 p-5">
            <div className="font-display text-base mb-3">
              <span className="font-mono text-xs text-muted-foreground mr-2">#{no.toString().padStart(2, "0")}</span>
              {g.title}
            </div>
            <ul className="divide-y divide-border">
              {g.items.map(({ item, idx }) => (
                <li key={idx} className="py-2.5 flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() => toggle(idx)}
                    className="mt-1 h-4 w-4 rounded border-border accent-[color:var(--brand)]"
                  />
                  <button
                    type="button"
                    onClick={() => toggle(idx)}
                    className="text-left flex-1 text-sm"
                  >
                    {item.fact}
                  </button>
                  <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                    {item.weight}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="rounded-2xl border border-border bg-card/60 p-5">
          <div className="font-display text-sm uppercase tracking-wider text-muted-foreground mb-2">
            Заметки / отвлечения от повестки
          </div>
          <textarea
            value={row.notes ?? ""}
            onChange={(e) => setField("notes", e.target.value)}
            placeholder="Цель, время, полученный результат…"
            className="w-full min-h-24 rounded-lg bg-input/40 border border-border px-3 py-2 text-sm"
            maxLength={4000}
          />
        </div>
      </section>
    </div>
  );
}
