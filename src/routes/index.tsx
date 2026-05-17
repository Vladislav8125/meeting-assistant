import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardCheck, Mic, Send, ArrowRight, Sparkles } from "lucide-react";
import { TopNav } from "@/components/TopNav";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "meetanalize — подготовка, анализ и рассылка по совещаниям" },
      {
        name: "description",
        content:
          "Три шага к эффективному совещанию: проверка материалов до встречи, AI-анализ записи и рассылка результатов участникам.",
      },
      { property: "og:title", content: "meetanalize · эффективное совещание" },
      {
        property: "og:description",
        content:
          "Подготовка · Анализ записи · Рассылка решений. Всё для совещаний, которые приносят результат.",
      },
    ],
  }),
});

const steps = [
  {
    to: "/prepare",
    n: "01",
    title: "Подготовка",
    text: "Загрузите повестку и материалы, опишите цель — ИИ оценит готовность к совещанию по 16 правилам и подскажет, чего не хватает.",
    icon: ClipboardCheck,
    cta: "Проверить материалы",
  },
  {
    to: "/meeting",
    n: "02",
    title: "Совещание",
    text: "Загрузите запись — получите транскрипт по спикерам, оценку по 16 правилам, решения, action items и рекомендации.",
    icon: Mic,
    cta: "Загрузить запись",
  },
  {
    to: "/distribute",
    n: "03",
    title: "Рассылка",
    text: "Разошлите отчёт нескольким получателям, отправьте action items каждому участнику персонально, скачайте печатную версию.",
    icon: Send,
    cta: "Открыть рассылки",
  },
] as const;

function Index() {
  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none" />
      <div className="absolute inset-0 bg-hero pointer-events-none" />
      <TopNav />
      <main className="relative z-10 max-w-6xl mx-auto px-6 pt-16 pb-24 w-full flex-1">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs font-mono text-muted-foreground">
          <Sparkles className="h-3 w-3 text-accent-2" />
          meetanalize · три шага к эффективному совещанию
        </div>
        <h1 className="mt-6 font-display text-5xl sm:text-6xl font-semibold leading-[0.95] max-w-3xl">
          Совещания, которые{" "}
          <span className="text-gradient">приносят результат</span>
        </h1>
        <p className="mt-5 text-lg text-muted-foreground max-w-2xl">
          Полный цикл: проверка материалов до встречи, AI-анализ записи и
          рассылка решений с action items участникам. Время анализа 5–15 минут.
        </p>

        <section className="mt-14 grid md:grid-cols-3 gap-4">
          {steps.map(({ to, n, title, text, icon: Icon, cta }) => (
            <Link
              key={to}
              to={to}
              className="group rounded-2xl border border-border bg-card/60 hover:bg-card hover:border-brand/40 transition p-6 flex flex-col"
            >
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-lg bg-brand/15 text-brand flex items-center justify-center">
                  <Icon className="h-5 w-5" />
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {n}
                </span>
              </div>
              <div className="mt-4 font-display text-2xl">{title}</div>
              <div className="text-sm text-muted-foreground mt-1.5 flex-1">
                {text}
              </div>
              <div className="mt-5 inline-flex items-center gap-1.5 text-sm font-mono text-brand group-hover:gap-2.5 transition-all">
                {cta} <ArrowRight className="h-4 w-4" />
              </div>
            </Link>
          ))}
        </section>

        <section className="mt-16 flex flex-wrap gap-8 text-sm">
          <Stat label="Правил оценки" value="16" />
          <Stat label="Языки" value="RU · EN" />
          <Stat label="Время анализа" value="5–15 мин" />
        </section>
      </main>
      <Footer />
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
