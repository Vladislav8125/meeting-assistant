import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Uploader } from "@/components/Uploader";
import { supabase } from "@/integrations/supabase/client";
import { retryAnalysis, kickPoll } from "@/lib/analyze.functions";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Mic, BarChart3, ShieldCheck, ArrowRight, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Lovable Analytics — AI-анализ совещаний и звонков" },
      {
        name: "description",
        content:
          "Загрузите аудио или видео — получите транскрипцию, оценку по 16 правилам успешного совещания и рекомендации.",
      },
      { property: "og:title", content: "Lovable Analytics" },
      {
        property: "og:description",
        content:
          "AI-анализ деловых разговоров: транскрипция, оценка по 16 правилам, рекомендации.",
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

function Index() {
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
        .limit(9)
        .then(({ data }) => {
          if (!active || !data) return;
          const rows = data as Recent[];
          setRecent(rows);
          // Auto-kick the polling cron if any record sits in transcribing > 3 min
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
    <div className="min-h-screen bg-background relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none" />
      <div className="absolute inset-0 bg-hero pointer-events-none" />

      <header className="relative z-10 max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand to-accent-2 shadow-glow" />
          <span className="font-display text-lg font-semibold">
            Lovable Analytics
          </span>
        </Link>
        <a
          href="#how"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Как это работает
        </a>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-6 pt-12 pb-24">
        <section className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs font-mono text-muted-foreground">
              <Sparkles className="h-3 w-3 text-accent-2" />
              meetanalize · эффективное совещание
            </div>
            <h1 className="mt-6 font-display text-5xl sm:text-6xl font-semibold leading-[0.95]">
              Совещания, которые <span className="text-gradient">приносят результат</span>
            </h1>
            <p className="mt-5 text-lg text-muted-foreground max-w-xl">
              Загрузите запись разговора — получите транскрипт с разделением по
              спикерам, оценку по&nbsp;16&nbsp;правилам успешного совещания и
              конкретные рекомендации.
            </p>
            <div className="mt-8 flex flex-wrap gap-6 text-sm">
              <Stat label="Правил оценки" value="16" />
              <Stat label="Языки" value="RU · EN" />
              <Stat label="Время анализа" value="5–15 мин" />
            </div>
          </div>

          <div className="lg:pl-6">
            <Uploader />
          </div>
        </section>

        <section id="how" className="mt-24 grid md:grid-cols-3 gap-4">
          <Feature
            icon={<Mic className="h-5 w-5" />}
            title="Транскрипция"
            text="Распознавание речи на русском и английском с разделением по спикерам."
          />
          <Feature
            icon={<BarChart3 className="h-5 w-5" />}
            title="Оценка по 16 правилам"
            text="Цель, подготовка, фиксация решений, тайминг, манипуляции — каждое правило с баллом и доказательством."
          />
          <Feature
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Безопасно"
            text="Файлы хранятся в вашей Cloud-инфраструктуре. Анализ выполняется на сервере."
          />
        </section>

        {recent.length > 0 && (
          <section className="mt-24">
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

      <footer className="relative z-10 border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-6 text-xs text-muted-foreground font-mono">
          © {new Date().getFullYear()} Lovable Analytics · MVP
        </div>
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-display text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/50 p-5">
      <div className="h-9 w-9 rounded-lg bg-brand/15 text-brand flex items-center justify-center">
        {icon}
      </div>
      <div className="mt-3 font-display text-lg">{title}</div>
      <div className="text-sm text-muted-foreground mt-1">{text}</div>
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
        {r.topic && (
          <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {r.topic}
          </div>
        )}
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
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-card hover:bg-accent/40 disabled:opacity-50 px-2 py-1.5 text-xs font-mono transition"
      >
        <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Запускаю…" : "Повторить обработку"}
      </button>
    </div>
  );
}

const STATUS_MAP: Record<
  string,
  { label: string; cls: string; progress: number; bar: string }
> = {
  pending: {
    label: "Ожидает",
    cls: "bg-muted text-muted-foreground",
    progress: 5,
    bar: "bg-muted-foreground/40",
  },
  processing: {
    label: "Обработка…",
    cls: "bg-brand/20 text-brand",
    progress: 25,
    bar: "bg-brand",
  },
  transcribing: {
    label: "Транскрипция…",
    cls: "bg-brand/20 text-brand",
    progress: 40,
    bar: "bg-brand",
  },
  analyzing: {
    label: "Анализ чанков…",
    cls: "bg-accent-2/20 text-accent-2",
    progress: 70,
    bar: "bg-accent-2",
  },
  synthesizing: {
    label: "Синтез отчёта…",
    cls: "bg-accent-2/20 text-accent-2",
    progress: 90,
    bar: "bg-accent-2",
  },
  done: {
    label: "Готово",
    cls: "bg-success/20 text-success",
    progress: 100,
    bar: "bg-success",
  },
  failed: {
    label: "Ошибка",
    cls: "bg-destructive/20 text-destructive",
    progress: 100,
    bar: "bg-destructive",
  },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.pending;
  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${s.cls}`}>
      {s.label}
    </span>
  );
}

function ProgressBar({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.pending;
  const animated =
    status !== "done" && status !== "failed" ? "animate-pulse" : "";
  return (
    <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full ${s.bar} ${animated} transition-all duration-500`}
        style={{ width: `${s.progress}%` }}
      />
    </div>
  );
}
