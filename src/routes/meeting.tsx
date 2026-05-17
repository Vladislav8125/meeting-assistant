import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Uploader } from "@/components/Uploader";
import { TopNav } from "@/components/TopNav";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { retryAnalysis, kickPoll } from "@/lib/analyze.functions";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Mic, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/meeting")({
  component: MeetingPage,
  head: () => ({
    meta: [
      { title: "Совещание — загрузка и анализ записи · meetanalize" },
      {
        name: "description",
        content:
          "Загрузите запись совещания и получите транскрипт, оценку по 16 правилам, action items и рекомендации.",
      },
    ],
  }),
});

type Recent = {
  id: string;
  file_name: string;
  status: string;
  created_at: string;
  updated_at: string | null;
  topic: string | null;
  language: string | null;
};

function MeetingPage() {
  const [recent, setRecent] = useState<Recent[]>([]);
  const router = useRouter();
  const kickPollFn = useServerFn(kickPoll);

  useEffect(() => {
    let active = true;
    const load = () => {
      supabase
        .from("analyses")
        .select("id,file_name,status,created_at,updated_at,topic,language")
        .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
        .order("created_at", { ascending: false })
        .limit(12)
        .then(({ data }) => {
          if (!active || !data) return;
          const rows = data as Recent[];
          setRecent(rows);
          const stuck = rows.some((r) => {
            if (r.status !== "transcribing") return false;
            const ts = r.updated_at ?? r.created_at;
            return (Date.now() - new Date(ts).getTime()) / 60000 > 3;
          });
          if (stuck) kickPollFn().catch(() => {});
        });
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [router.state.location.pathname, kickPollFn]);

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none" />
      <div className="absolute inset-0 bg-hero pointer-events-none" />
      <TopNav />
      <main className="relative z-10 max-w-6xl mx-auto px-6 pt-12 pb-24 w-full flex-1">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-brand/15 text-brand flex items-center justify-center">
            <Mic className="h-5 w-5" />
          </div>
          <div>
            <div className="font-mono text-xs text-muted-foreground">Шаг 2</div>
            <h1 className="font-display text-3xl font-semibold">Совещание</h1>
          </div>
        </div>
        <p className="mt-3 text-muted-foreground max-w-2xl">
          Загрузите запись разговора — получите транскрипт по спикерам, оценку
          по 16 правилам и рекомендации. Транскрибация на русском по умолчанию.
        </p>

        <div className="mt-10 grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <Uploader />
          </div>
          <aside className="lg:col-span-2 rounded-2xl border border-border bg-card/50 p-5 text-sm">
            <div className="font-display text-lg mb-2">Что получите</div>
            <ul className="space-y-2 text-muted-foreground">
              <li>· Транскрипт с разделением по спикерам</li>
              <li>· Оценку по 16 правилам успешного совещания</li>
              <li>· Решения, action items, риски, возражения</li>
              <li>· Итоговый балл 0–100 и рекомендации</li>
              <li>· Полные логи запросов для отладки</li>
            </ul>
            <div className="mt-4 rounded-lg border border-border bg-background/60 p-3 text-xs font-mono text-muted-foreground">
              После анализа перейдите в шаг 3 — рассылка отчёта и action items.
            </div>
          </aside>
        </div>

        {recent.length > 0 && (
          <section className="mt-16">
            <div className="relative rounded-2xl p-[1px] bg-gradient-to-br from-brand/60 via-accent-2/40 to-transparent shadow-glow">
              <div className="rounded-2xl bg-card/80 backdrop-blur-sm p-6">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="font-display text-2xl">Очередь обработки</h2>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    обновляется автоматически
                  </span>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {recent.map((r) => (
                    <RecentCard key={r.id} r={r} />
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function minutesSince(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function RecentCard({ r }: { r: Recent }) {
  const retryFn = useServerFn(retryAnalysis);
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const updatedAt = r.updated_at ?? r.created_at;
  const inStatus = minutesSince(updatedAt);
  const isFinal = r.status === "done" || r.status === "failed";
  const isStuck = !isFinal && inStatus >= 10;

  const onRetry = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const res = await retryFn({ data: { analysisId: r.id } });
      if (res?.ok) toast.success("Обработка перезапущена");
      else toast.error(res?.error || "Не удалось перезапустить");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-background/60 hover:bg-background transition p-4">
      <Link to="/analysis/$id" params={{ id: r.id }} className="block">
        <div className="flex items-center justify-between mb-2">
          <StatusPill status={r.status} />
          <span className="text-[11px] font-mono text-muted-foreground">
            {fmtTime(r.created_at)}
          </span>
        </div>
        <div className="font-mono text-sm truncate">{r.file_name}</div>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          {r.language && <LanguagePill lang={r.language} />}
          {r.topic && (
            <span className="text-xs text-muted-foreground line-clamp-1">
              {r.topic}
            </span>
          )}
        </div>
        <ProgressBar status={r.status} />
        <div className="mt-2 flex items-center justify-between text-[11px] font-mono">
          <span className="text-muted-foreground">
            обновлено {fmtTime(updatedAt)}
          </span>
          <span className={isStuck ? "text-destructive" : "text-muted-foreground"}>
            в статусе {inStatus} мин{isStuck ? " · возможно застряло" : ""}
          </span>
        </div>
      </Link>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          disabled={busy}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card hover:bg-accent/40 disabled:opacity-50 px-2 py-1.5 text-xs font-mono transition"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Запускаю…" : "Повторить"}
        </button>
        {r.status === "done" && (
          <Link
            to="/distribute/$id"
            params={{ id: r.id }}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-brand/40 bg-brand/10 text-brand hover:bg-brand/20 px-2 py-1.5 text-xs font-mono transition"
          >
            Рассылка →
          </Link>
        )}
      </div>
    </div>
  );
}

const STATUS_MAP: Record<
  string,
  { label: string; cls: string; progress: number; bar: string }
> = {
  pending: { label: "Ожидает", cls: "bg-muted text-muted-foreground", progress: 5, bar: "bg-muted-foreground/40" },
  processing: { label: "Обработка…", cls: "bg-brand/20 text-brand", progress: 25, bar: "bg-brand" },
  transcribing: { label: "Транскрипция…", cls: "bg-brand/20 text-brand", progress: 40, bar: "bg-brand" },
  analyzing: { label: "Анализ чанков…", cls: "bg-accent-2/20 text-accent-2", progress: 70, bar: "bg-accent-2" },
  synthesizing: { label: "Синтез отчёта…", cls: "bg-accent-2/20 text-accent-2", progress: 90, bar: "bg-accent-2" },
  done: { label: "Готово", cls: "bg-success/20 text-success", progress: 100, bar: "bg-success" },
  failed: { label: "Ошибка", cls: "bg-destructive/20 text-destructive", progress: 100, bar: "bg-destructive" },
};

function LanguagePill({ lang }: { lang: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    ru: { label: "RU · Русский", cls: "bg-brand/15 text-brand border-brand/30" },
    en: { label: "EN · English", cls: "bg-accent-2/15 text-accent-2 border-accent-2/30" },
    mixed: { label: "Смешанный", cls: "bg-warn/15 text-warn border-warn/30" },
    unknown: { label: "?", cls: "bg-muted text-muted-foreground border-border" },
  };
  const m = map[lang] ?? { label: lang.toUpperCase(), cls: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${m.cls}`}>{m.label}</span>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.pending;
  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
  );
}

function ProgressBar({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.pending;
  const animated = status !== "done" && status !== "failed" ? "animate-pulse" : "";
  return (
    <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div className={`h-full ${s.bar} ${animated} transition-all duration-500`} style={{ width: `${s.progress}%` }} />
    </div>
  );
}
