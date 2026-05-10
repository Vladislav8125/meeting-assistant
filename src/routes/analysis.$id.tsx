import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, AlertTriangle, Mail, ChevronDown } from "lucide-react";
import { sendReportEmail } from "@/lib/analyze.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/analysis/$id")({
  component: AnalysisPage,
  errorComponent: ({ error, reset }) => (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <p className="text-destructive">{error.message}</p>
        <button
          onClick={reset}
          className="mt-4 rounded-lg bg-brand text-brand-foreground px-4 py-2 text-sm"
        >
          Повторить
        </button>
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen flex items-center justify-center">
      Анализ не найден
    </div>
  ),
});

type Rule = {
  id: number;
  title: string;
  score: number;
  evidence?: string;
  recommendation?: string;
};

type Report = {
  language?: string;
  duration_estimate?: string;
  summary?: string;
  goal?: { stated?: string; clarity_score?: number; comment?: string };
  participants?: { label: string; role_guess?: string; talk_share_pct?: number }[];
  key_points?: string[];
  decisions?: string[];
  action_items?: { task: string; owner?: string; deadline?: string }[];
  questions_objections?: string[];
  risks?: string[];
  rules_assessment?: Rule[];
  overall_score?: number;
  verdict?: string;
  recommendations?: string[];
  transcript?: string;
};

type LogEntry = {
  ts: string;
  source: string;
  level: "info" | "warn" | "error";
  message: string;
  data?: unknown;
};

type Analysis = {
  id: string;
  file_name: string;
  status: string;
  topic: string | null;
  participants: string | null;
  transcript: string | null;
  report: Report | null;
  error: string | null;
  created_at: string;
  storage_path: string;
  mime_type: string | null;
  language: string | null;
  recipient_email: string | null;
  email_sent_at: string | null;
  logs: LogEntry[] | null;
};

function AnalysisPage() {
  const { id } = Route.useParams();
  const [data, setData] = useState<Analysis | null>(null);

  useEffect(() => {
    let stop = false;

    const load = async () => {
      const { data } = await supabase
        .from("analyses")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (!stop) setData(data as Analysis | null);
    };
    load();

    const ch = supabase
      .channel(`analysis:${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "analyses", filter: `id=eq.${id}` },
        (payload) => {
          if (!stop) setData(payload.new as Analysis);
        },
      )
      .subscribe();

    const poll = setInterval(load, 6000);

    return () => {
      stop = true;
      clearInterval(poll);
      supabase.removeChannel(ch);
    };
  }, [id]);

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Загрузка…
      </div>
    );
  }

  const r = data.report;

  return (
    <div className="min-h-screen bg-background">
      <div className="absolute inset-x-0 top-0 h-72 bg-hero pointer-events-none" />
      <div className="relative max-w-5xl mx-auto px-6 py-8">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> К загрузке
        </Link>

        <header className="mt-6 flex flex-wrap gap-4 items-start justify-between">
          <div>
            <div className="font-mono text-xs text-muted-foreground">
              {new Date(data.created_at).toLocaleString("ru-RU")}
            </div>
            <h1 className="font-display text-3xl sm:text-4xl mt-1">
              {data.topic || data.file_name}
            </h1>
            {data.participants && (
              <div className="text-sm text-muted-foreground mt-1">
                Участники: {data.participants}
              </div>
            )}
          </div>
          <ScoreBadge score={r?.overall_score} status={data.status} />
        </header>

        {data.status !== "done" && data.status !== "failed" ? (
          <ProcessingState status={data.status} />
        ) : data.status === "failed" ? (
          <div className="mt-8 rounded-xl border border-destructive/40 bg-destructive/10 p-5 flex gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Не удалось проанализировать</div>
              <div className="text-sm text-muted-foreground mt-1">
                {data.error || "Неизвестная ошибка"}
              </div>
            </div>
          </div>
        ) : (
          r && <ReportView r={r} />
        )}
      </div>
    </div>
  );
}

function ProcessingState({ status }: { status: string }) {
  const label =
    status === "pending"
      ? "В очереди…"
      : status === "transcribing"
        ? "Транскрибируем запись…"
        : status === "analyzing"
          ? "Анализируем фрагменты…"
          : status === "synthesizing"
            ? "Собираем итоговый отчёт…"
            : "Обрабатываем…";
  return (
    <div className="mt-10 rounded-2xl border border-border bg-card/60 p-8 text-center">
      <Loader2 className="h-7 w-7 animate-spin mx-auto text-brand" />
      <div className="mt-3 font-display text-xl">{label}</div>
      <div className="text-sm text-muted-foreground mt-1">
        Длинные записи разбиваются на фрагменты и обрабатываются параллельно.
      </div>
    </div>
  );
}

function ScoreBadge({ score, status }: { score?: number; status: string }) {
  if (status !== "done" || score == null) return null;
  const color =
    score >= 75 ? "text-success" : score >= 50 ? "text-warn" : "text-destructive";
  return (
    <div className="rounded-2xl border border-border bg-card/60 px-5 py-3 text-center">
      <div className={`font-display text-4xl font-semibold ${color}`}>
        {score}
        <span className="text-base text-muted-foreground">/100</span>
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Общая оценка
      </div>
    </div>
  );
}

function ReportView({ r }: { r: Report }) {
  return (
    <div className="mt-8 space-y-6">
      {r.verdict && (
        <Card title="Вердикт">
          <p className="text-base leading-relaxed">{r.verdict}</p>
          {r.summary && (
            <p className="mt-3 text-sm text-muted-foreground">{r.summary}</p>
          )}
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {r.goal && (
          <Card title="Цель встречи">
            <div className="text-sm">{r.goal.stated || "—"}</div>
            {r.goal.clarity_score != null && (
              <div className="mt-2 text-xs font-mono text-muted-foreground">
                Чёткость: {r.goal.clarity_score}/10
              </div>
            )}
            {r.goal.comment && (
              <div className="mt-2 text-sm text-muted-foreground">
                {r.goal.comment}
              </div>
            )}
          </Card>
        )}
        {r.duration_estimate && (
          <Card title="Длительность (оценка)">
            <div className="font-mono text-2xl">{r.duration_estimate}</div>
          </Card>
        )}
      </div>

      <ListCard title="Ключевые тезисы" items={r.key_points} />
      <ListCard title="Принятые решения" items={r.decisions} />

      {r.action_items && r.action_items.length > 0 && (
        <Card title="Action items">
          <ul className="divide-y divide-border">
            {r.action_items.map((a, i) => (
              <li key={i} className="py-2 flex flex-wrap gap-x-3 text-sm">
                <span className="flex-1">{a.task}</span>
                {a.owner && (
                  <span className="font-mono text-xs text-brand">{a.owner}</span>
                )}
                {a.deadline && (
                  <span className="font-mono text-xs text-muted-foreground">
                    {a.deadline}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ListCard title="Вопросы и возражения" items={r.questions_objections} />
      <ListCard title="Риски" items={r.risks} />

      {r.rules_assessment && r.rules_assessment.length > 0 && (
        <Card title="Оценка по 16 правилам">
          <div className="grid sm:grid-cols-2 gap-3">
            {r.rules_assessment.map((rule) => (
              <RuleCard key={rule.id} rule={rule} />
            ))}
          </div>
        </Card>
      )}

      <ListCard title="Главные рекомендации" items={r.recommendations} accent />

      {r.transcript && (
        <Card title="Транскрипт">
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground max-h-[480px] overflow-auto">
            {r.transcript}
          </pre>
        </Card>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card/60 p-5">
      <h3 className="font-display text-sm uppercase tracking-wider text-muted-foreground mb-3">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ListCard({
  title,
  items,
  accent,
}: {
  title: string;
  items?: string[];
  accent?: boolean;
}) {
  if (!items || items.length === 0) return null;
  return (
    <Card title={title}>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span
              className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${
                accent ? "bg-accent-2" : "bg-brand"
              }`}
            />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RuleCard({ rule }: { rule: Rule }) {
  const score = Math.max(0, Math.min(10, rule.score ?? 0));
  const color =
    score >= 7
      ? "var(--success)"
      : score >= 4
        ? "var(--warn)"
        : "var(--destructive)";
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-mono text-muted-foreground">
          #{rule.id.toString().padStart(2, "0")}
        </div>
        <div className="font-mono text-sm" style={{ color }}>
          {score}/10
        </div>
      </div>
      <div className="font-display text-sm mt-1">{rule.title}</div>
      <div
        className="mt-2 h-1 rounded-full overflow-hidden"
        style={{ background: "color-mix(in oklab, var(--foreground) 8%, transparent)" }}
      >
        <div
          className="h-full"
          style={{ width: `${score * 10}%`, background: color }}
        />
      </div>
      {rule.evidence && (
        <div className="mt-2 text-xs text-muted-foreground line-clamp-3">
          {rule.evidence}
        </div>
      )}
      {rule.recommendation && (
        <div className="mt-2 text-xs text-foreground/80 line-clamp-3">
          → {rule.recommendation}
        </div>
      )}
    </div>
  );
}
