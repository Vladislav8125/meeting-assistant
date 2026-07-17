import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, ClipboardCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { makeEmptyItems } from "@/lib/checklist-config";

export const Route = createFileRoute("/_authenticated/app/checklist/")({
  component: ChecklistList,
});

type Row = {
  id: string;
  topic: string;
  moderator: string | null;
  meeting_date: string | null;
  score: number | null;
  created_at: string;
};

function ChecklistList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    const { data } = await supabase
      .from("meeting_checklists")
      .select("id,topic,moderator,meeting_date,score,created_at")
      .order("created_at", { ascending: false });
    setRows((data as Row[]) ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!topic.trim()) return toast.error("Введите тему совещания");
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data, error } = await supabase
      .from("meeting_checklists")
      .insert({
        user_id: u.user.id,
        topic: topic.trim(),
        items: makeEmptyItems() as never,
        score: 0,
      })
      .select("id")
      .single();
    setBusy(false);
    if (error) return toast.error(error.message);
    if (data) navigate({ to: "/app/checklist/$id", params: { id: data.id } });
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="h-10 w-10 rounded-lg bg-brand/15 text-brand flex items-center justify-center">
          <ClipboardCheck className="h-5 w-5" />
        </div>
        <div>
          <div className="font-mono text-xs text-muted-foreground">Стадия 1</div>
          <h1 className="font-display text-3xl font-semibold">Чек-лист «Успешное совещание»</h1>
        </div>
      </div>
      <p className="text-muted-foreground max-w-2xl">
        16 правил, 29 факт-чеков с весами. Отметьте выполненное — получите итоговую оценку готовности и проведения совещания.
      </p>

      <div className="mt-6 rounded-2xl border border-border bg-card/60 p-4 flex flex-wrap gap-2">
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Новое совещание: тема"
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
          <div className="text-sm text-muted-foreground">Пока нет чек-листов.</div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rows.map((r) => (
              <Link
                key={r.id}
                to="/app/checklist/$id"
                params={{ id: r.id }}
                className="rounded-xl border border-border bg-card/60 hover:bg-card hover:border-brand/40 p-4 transition"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("ru-RU")}
                  </span>
                  <ScorePill score={r.score ?? 0} />
                </div>
                <div className="font-display text-base leading-tight line-clamp-2">{r.topic}</div>
                {r.moderator && (
                  <div className="text-xs text-muted-foreground mt-2">Модератор: {r.moderator}</div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  const cls = score >= 75 ? "bg-success/20 text-success" : score >= 50 ? "bg-warn/20 text-warn" : "bg-destructive/20 text-destructive";
  return <span className={`text-xs font-mono px-2 py-0.5 rounded ${cls}`}>{score}%</span>;
}
