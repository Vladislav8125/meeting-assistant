import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Uploader } from "@/components/Uploader";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { Sparkles, Mic, BarChart3, ShieldCheck, ArrowRight } from "lucide-react";

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
  topic: string | null;
};

function Index() {
  const [recent, setRecent] = useState<Recent[]>([]);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    const load = () => {
      supabase
        .from("analyses")
        .select("id,file_name,status,created_at,topic")
        .gte("created_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
        .order("created_at", { ascending: false })
        .limit(9)
        .then(({ data }) => {
          if (active && data) setRecent(data as Recent[]);
        });
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [router.state.location.pathname]);

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

        {recent.length > 0 && (
          <section className="mt-20">
            <h2 className="font-display text-2xl mb-4">Последние анализы</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {recent.map((r) => (
                <Link
                  key={r.id}
                  to="/analysis/$id"
                  params={{ id: r.id }}
                  className="group rounded-xl border border-border bg-card/50 hover:bg-card transition p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <StatusPill status={r.status} />
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("ru-RU")}
                    </span>
                  </div>
                  <div className="font-mono text-sm truncate">{r.file_name}</div>
                  {r.topic && (
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {r.topic}
                    </div>
                  )}
                  <div className="mt-3 inline-flex items-center gap-1 text-xs text-brand opacity-0 group-hover:opacity-100 transition">
                    Открыть отчёт <ArrowRight className="h-3 w-3" />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

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

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "Ожидает", cls: "bg-muted text-muted-foreground" },
    processing: { label: "Анализ…", cls: "bg-brand/20 text-brand" },
    done: { label: "Готово", cls: "bg-success/20 text-success" },
    failed: { label: "Ошибка", cls: "bg-destructive/20 text-destructive" },
  };
  const s = map[status] ?? map.pending;
  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${s.cls}`}>
      {s.label}
    </span>
  );
}
