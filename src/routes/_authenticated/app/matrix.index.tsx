import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Layers, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { makeEmptyStages, summarizeMatrix, type MatrixStage } from "@/lib/matrix-config";

export const Route = createFileRoute("/_authenticated/app/matrix/")({
  component: MatrixList,
});

type Row = {
  id: string;
  topic: string;
  moderator: string | null;
  meeting_date: string | null;
  readiness_percent: number | null;
  blocking_count: number | null;
  verdict_label: string | null;
  created_at: string;
  stages: MatrixStage[];
};

function MatrixList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    supabase
      .from("meeting_preparations")
      .select("id,topic,moderator,meeting_date,readiness_percent,blocking_count,verdict_label,created_at,stages")
      .order("created_at", { ascending: false })
      .then(({ data }) => setRows((data as Row[]) ?? []));
  }, []);

  const create = async () => {
    if (!topic.trim()) return toast.error("Введите тему");
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const stages = makeEmptyStages();
    const sum = summarizeMatrix(stages);
    const { data, error } = await supabase
      .from("meeting_preparations")
      .insert({
        user_id: u.user.id,
        topic: topic.trim(),
        stages: stages as never,
        ...sum,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error) return toast.error(error.message);
    if (data) navigate({ to: "/app/matrix/$id", params: { id: data.id } });
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="h-10 w-10 rounded-lg bg-brand/15 text-brand flex items-center justify-center">
          <Layers className="h-5 w-5" />
        </div>
        <div>
          <div className="font-mono text-xs text-muted-foreground">Стадия 2</div>
          <h1 className="font-display text-3xl font-semibold">Журнал + матрица подготовки</h1>
        </div>
      </div>
      <p className="text-muted-foreground max-w-2xl">
        10 этапов подготовки, статусы из матрицы, ответственные, сроки. На выходе — % готовности, число блокирующих этапов и вердикт.
      </p>

      <div className="mt-6 rounded-2xl border border-border bg-card/60 p-4 flex flex-wrap gap-2">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Новая подготовка: название совещания"
          maxLength={500}
          className="flex-1 min-w-[240px] rounded-lg bg-input/40 border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/60"
          onKeyDown={(e) => e.key === "Enter" && create()}
          disabled={busy}
        />
        <button
          onClick={create}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand text-brand-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Создать
        </button>
      </div>

      <div className="mt-8">
        {rows == null ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">Пока нет подготовок.</div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rows.map((r) => (
              <Link
                key={r.id}
                to="/app/matrix/$id"
                params={{ id: r.id }}
                className="rounded-xl border border-border bg-card/60 hover:bg-card hover:border-brand/40 p-4 transition"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString("ru-RU")}
                  </span>
                  <ReadinessPill p={r.readiness_percent ?? 0} />
                </div>
                <div className="font-display text-base leading-tight line-clamp-2">{r.topic}</div>
                <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px] font-mono text-muted-foreground">
                  {r.moderator && <span>{r.moderator}</span>}
                  {(r.blocking_count ?? 0) > 0 && (
                    <span className="text-destructive">блок: {r.blocking_count}</span>
                  )}
                </div>
                {r.verdict_label && (
                  <div className="mt-2 text-[11px] font-mono text-foreground/70">{r.verdict_label}</div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ReadinessPill({ p }: { p: number }) {
  const cls = p >= 85 ? "bg-success/20 text-success" : p >= 60 ? "bg-warn/20 text-warn" : "bg-destructive/20 text-destructive";
  return <span className={`text-xs font-mono px-2 py-0.5 rounded ${cls}`}>{p}%</span>;
}
