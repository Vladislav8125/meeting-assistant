import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useCallback } from "react";
import { TopNav } from "@/components/TopNav";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { runReadinessCheck } from "@/lib/prepare.functions";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, Loader2, CheckCircle2, XCircle, FileText } from "lucide-react";

export const Route = createFileRoute("/prepare/$id")({
  component: PrepareDetail,
});

type Material = { name: string; path: string; size: number };
type Check = { id: number; title: string; ok: boolean; comment?: string };

type Prep = {
  id: string;
  topic: string;
  goal: string | null;
  agenda: string | null;
  participants: string | null;
  expected_decision: string | null;
  materials: Material[];
  readiness_score: number | null;
  verdict: string | null;
  checks: Check[] | null;
  recommendations: string[] | null;
  status: string;
  created_at: string;
};

function PrepareDetail() {
  const { id } = Route.useParams();
  const [prep, setPrep] = useState<Prep | null>(null);
  const [busy, setBusy] = useState(false);
  const checkFn = useServerFn(runReadinessCheck);

  const load = useCallback(() => {
    supabase
      .from("meeting_preparations")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data }) => {
        if (data) setPrep(data as unknown as Prep);
      });
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const recheck = async () => {
    setBusy(true);
    try {
      const res = await checkFn({ data: { preparationId: id } });
      if (!res.ok) toast.error(res.error || "Ошибка");
      else toast.success("Готовность переоценена");
      load();
    } finally {
      setBusy(false);
    }
  };

  if (!prep) {
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

  return (
    <div className="min-h-screen flex flex-col bg-background relative">
      <TopNav />
      <main className="relative z-10 max-w-5xl mx-auto px-6 pt-10 pb-24 w-full flex-1">
        <Link to="/prepare" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> К подготовкам
        </Link>
        <div className="mt-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold">{prep.topic}</h1>
            {prep.verdict && (
              <p className="mt-2 text-muted-foreground max-w-3xl">{prep.verdict}</p>
            )}
          </div>
          <ScoreBlock score={prep.readiness_score} />
        </div>

        <div className="mt-8 grid md:grid-cols-2 gap-4">
          <Field label="Цель" value={prep.goal} />
          <Field label="Ожидаемое решение" value={prep.expected_decision} />
          <Field label="Повестка" value={prep.agenda} wide />
          <Field label="Участники" value={prep.participants} />
        </div>

        {prep.materials?.length > 0 && (
          <section className="mt-8">
            <div className="font-display text-lg mb-2">Материалы</div>
            <div className="space-y-1">
              {prep.materials.map((m, i) => (
                <a
                  key={i}
                  href={supabase.storage.from("media").getPublicUrl(m.path).data.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-md border border-border bg-card/60 px-3 py-2 text-sm hover:bg-card transition"
                >
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{m.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {(m.size / 1024).toFixed(0)} КБ
                  </span>
                </a>
              ))}
            </div>
          </section>
        )}

        {prep.checks && prep.checks.length > 0 && (
          <section className="mt-8">
            <div className="font-display text-lg mb-2">Проверки</div>
            <div className="grid md:grid-cols-2 gap-2">
              {prep.checks.map((c) => (
                <div key={c.id} className="rounded-lg border border-border bg-card/60 p-3 flex gap-3">
                  {c.ok ? (
                    <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="text-sm font-medium">{c.id}. {c.title}</div>
                    {c.comment && (
                      <div className="text-xs text-muted-foreground mt-0.5">{c.comment}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {prep.recommendations && prep.recommendations.length > 0 && (
          <section className="mt-8">
            <div className="font-display text-lg mb-2">Рекомендации</div>
            <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
              {prep.recommendations.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-10 flex gap-3">
          <button
            type="button"
            onClick={recheck}
            disabled={busy || prep.status === "checking"}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card hover:bg-accent/40 px-4 py-2 text-sm font-mono disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            Переоценить
          </button>
          <Link
            to="/meeting"
            className="inline-flex items-center gap-2 rounded-lg bg-brand text-brand-foreground px-4 py-2 text-sm font-semibold"
          >
            Перейти к загрузке записи →
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function Field({ label, value, wide }: { label: string; value: string | null; wide?: boolean }) {
  return (
    <div className={`rounded-lg border border-border bg-card/40 p-3 ${wide ? "md:col-span-2" : ""}`}>
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm whitespace-pre-wrap">{value || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

function ScoreBlock({ score }: { score: number | null }) {
  if (score == null) {
    return (
      <div className="rounded-xl border border-border bg-card/60 p-4 text-center min-w-[100px]">
        <div className="text-2xl font-display text-muted-foreground">—</div>
        <div className="text-[10px] font-mono uppercase text-muted-foreground">оценка</div>
      </div>
    );
  }
  const cls =
    score >= 70 ? "text-success" : score >= 40 ? "text-warn" : "text-destructive";
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4 text-center min-w-[100px]">
      <div className={`text-3xl font-display font-semibold ${cls}`}>{score}</div>
      <div className="text-[10px] font-mono uppercase text-muted-foreground">из 100</div>
    </div>
  );
}
