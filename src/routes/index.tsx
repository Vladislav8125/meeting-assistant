import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardCheck, Layers, Mic, BookOpen, ArrowRight, Sparkles, LogIn } from "lucide-react";
import { Footer } from "@/components/Footer";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "meetanalize — личный кабинет для эффективных совещаний" },
      { name: "description", content: "Чек-лист подготовки, матрица этапов, AI-анализ записи и архив совещаний — в одном личном кабинете." },
      { property: "og:title", content: "meetanalize · эффективное совещание" },
      { property: "og:description", content: "Подготовка · Матрица · Анализ записи · Журнал. Всё для совещаний, которые приносят результат." },
    ],
  }),
});

const steps = [
  { n: "01", title: "Чек-лист", text: "16 правил, 29 факт-чеков с весами. Контроль подготовки и проведения.", icon: ClipboardCheck },
  { n: "02", title: "Матрица этапов", text: "10 этапов подготовки со статусами, ответственными и сроками. Готовность в %.", icon: Layers },
  { n: "03", title: "Анализ записи", text: "Транскрипция, оценка по 16 правилам, action items, PDF-итог.", icon: Mic },
] as const;

function Index() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setAuthed(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const cta = authed ? { to: "/app/checklist" as const, label: "Открыть кабинет" } : { to: "/auth" as const, label: "Войти / зарегистрироваться" };

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none" />
      <div className="absolute inset-0 bg-hero pointer-events-none" />
      <header className="relative z-20 border-b border-border bg-background/60 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-brand to-accent-2 shadow-glow" />
            <span className="font-display text-base font-semibold">meetanalize</span>
          </Link>
          <Link to={cta.to} className="inline-flex items-center gap-1.5 rounded-md border border-brand/40 bg-brand/10 text-brand px-3 py-1.5 text-xs font-mono hover:bg-brand/20">
            <LogIn className="h-3.5 w-3.5" /> {cta.label}
          </Link>
        </div>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-6 pt-16 pb-24 w-full flex-1">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs font-mono text-muted-foreground">
          <Sparkles className="h-3 w-3 text-accent-2" />
          meetanalize · личный кабинет
        </div>
        <h1 className="mt-6 font-display text-5xl sm:text-6xl font-semibold leading-[0.95] max-w-3xl">
          Совещания, которые <span className="text-gradient">приносят результат</span>
        </h1>
        <p className="mt-5 text-lg text-muted-foreground max-w-2xl">
          Три стадии в одном кабинете: подготовка по чек-листу, контроль этапов по матрице, AI-анализ записи. Архив всех совещаний — рядом.
        </p>
        <div className="mt-7">
          <Link to={cta.to} className="inline-flex items-center gap-2 rounded-lg bg-brand text-brand-foreground px-5 py-3 text-sm font-semibold shadow-glow hover:opacity-95">
            {cta.label} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <section className="mt-14 grid md:grid-cols-3 gap-4">
          {steps.map(({ n, title, text, icon: Icon }) => (
            <div key={n} className="rounded-2xl border border-border bg-card/60 p-6 flex flex-col">
              <div className="flex items-center justify-between">
                <div className="h-10 w-10 rounded-lg bg-brand/15 text-brand flex items-center justify-center"><Icon className="h-5 w-5" /></div>
                <span className="font-mono text-xs text-muted-foreground">{n}</span>
              </div>
              <div className="mt-4 font-display text-2xl">{title}</div>
              <div className="text-sm text-muted-foreground mt-1.5 flex-1">{text}</div>
            </div>
          ))}
        </section>

        <section className="mt-12 rounded-2xl border border-border bg-card/40 p-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-accent-2" />
            <div>
              <div className="font-display text-lg">Архив «Все совещания»</div>
              <div className="text-sm text-muted-foreground">Журнал по всем стадиям с фильтрами и экспортом в CSV.</div>
            </div>
          </div>
          <Link to={cta.to} className="text-sm font-mono text-brand whitespace-nowrap">Открыть →</Link>
        </section>
      </main>
      <Footer />
    </div>
  );
}
