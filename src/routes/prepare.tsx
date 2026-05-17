import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useCallback } from "react";
import { TopNav } from "@/components/TopNav";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { runReadinessCheck } from "@/lib/prepare.functions";
import { toast } from "sonner";
import {
  ClipboardCheck,
  Upload,
  Loader2,
  Sparkles,
  FileText,
  Trash2,
} from "lucide-react";

export const Route = createFileRoute("/prepare")({
  component: PreparePage,
  head: () => ({
    meta: [
      { title: "Подготовка к совещанию · meetanalize" },
      {
        name: "description",
        content:
          "Опишите цель, повестку и участников, загрузите материалы — ИИ оценит готовность к совещанию.",
      },
    ],
  }),
});

type Prep = {
  id: string;
  topic: string;
  status: string;
  readiness_score: number | null;
  verdict: string | null;
  created_at: string;
};

type Material = { name: string; path: string; size: number };

function PreparePage() {
  const [list, setList] = useState<Prep[]>([]);
  const [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState("");
  const [goal, setGoal] = useState("");
  const [agenda, setAgenda] = useState("");
  const [participants, setParticipants] = useState("");
  const [expected, setExpected] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState("");

  const checkFn = useServerFn(runReadinessCheck);

  const load = useCallback(() => {
    supabase
      .from("meeting_preparations")
      .select("id,topic,status,readiness_score,verdict,created_at")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (data) setList(data as Prep[]);
      });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const submit = async () => {
    if (!topic.trim()) {
      toast.error("Укажите тему встречи");
      return;
    }
    setBusy(true);
    try {
      setProgress("Создаю запись…");
      const { data: row, error } = await supabase
        .from("meeting_preparations")
        .insert({
          topic: topic.trim(),
          goal: goal.trim() || null,
          agenda: agenda.trim() || null,
          participants: participants.trim() || null,
          expected_decision: expected.trim() || null,
          materials: [],
          status: "draft",
        })
        .select()
        .single();
      if (error || !row) throw error ?? new Error("insert failed");

      const materials: Material[] = [];
      for (const f of files) {
        setProgress(`Загружаю ${f.name}…`);
        const path = `preparations/${row.id}/${crypto.randomUUID()}-${f.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage
          .from("media")
          .upload(path, f, { contentType: f.type, upsert: false });
        if (upErr) throw upErr;
        materials.push({ name: f.name, path, size: f.size });
      }
      if (materials.length) {
        await supabase
          .from("meeting_preparations")
          .update({ materials: materials as never })
          .eq("id", row.id);
      }

      setProgress("ИИ проверяет готовность…");
      const res = await checkFn({ data: { preparationId: row.id } });
      if (!res.ok) toast.error(res.error || "Не удалось выполнить проверку");
      else toast.success("Готовность оценена");

      setTopic("");
      setGoal("");
      setAgenda("");
      setParticipants("");
      setExpected("");
      setFiles([]);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none" />
      <TopNav />
      <main className="relative z-10 max-w-6xl mx-auto px-6 pt-12 pb-24 w-full flex-1">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-brand/15 text-brand flex items-center justify-center">
            <ClipboardCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="font-mono text-xs text-muted-foreground">Шаг 1</div>
            <h1 className="font-display text-3xl font-semibold">Подготовка</h1>
          </div>
        </div>
        <p className="mt-3 text-muted-foreground max-w-2xl">
          Опишите встречу, прикрепите повестку и материалы. ИИ оценит
          готовность по 16 правилам и подскажет, чего не хватает.
        </p>

        <div className="mt-10 grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 rounded-2xl border border-border bg-card/60 backdrop-blur-md p-6 shadow-glow">
            <div className="grid sm:grid-cols-2 gap-3">
              <input
                className="sm:col-span-2 rounded-lg bg-input/40 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/60"
                placeholder="Тема встречи *"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={300}
                disabled={busy}
              />
              <textarea
                className="sm:col-span-2 rounded-lg bg-input/40 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/60 min-h-[72px]"
                placeholder="Цель встречи — какое решение должно быть принято"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                maxLength={1000}
                disabled={busy}
              />
              <textarea
                className="sm:col-span-2 rounded-lg bg-input/40 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/60 min-h-[100px]"
                placeholder="Повестка / структура — пункты сверху вниз"
                value={agenda}
                onChange={(e) => setAgenda(e.target.value)}
                maxLength={3000}
                disabled={busy}
              />
              <input
                className="rounded-lg bg-input/40 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/60"
                placeholder="Участники и ответственные"
                value={participants}
                onChange={(e) => setParticipants(e.target.value)}
                maxLength={1000}
                disabled={busy}
              />
              <input
                className="rounded-lg bg-input/40 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/60"
                placeholder="Ожидаемое решение"
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                maxLength={500}
                disabled={busy}
              />
            </div>

            <label
              htmlFor="prep-files"
              className="mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border hover:border-brand/60 transition-colors p-6 cursor-pointer text-center"
            >
              <input
                id="prep-files"
                type="file"
                multiple
                className="sr-only"
                onChange={(e) =>
                  setFiles(Array.from(e.target.files ?? []).slice(0, 10))
                }
                disabled={busy}
              />
              <Upload className="h-7 w-7 text-muted-foreground" />
              <div className="text-sm">Прикрепить материалы (повестка, документы, ссылки)</div>
              <div className="text-xs text-muted-foreground">до 10 файлов · PDF, DOCX, изображения</div>
            </label>
            {files.length > 0 && (
              <div className="mt-3 space-y-1">
                {files.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-md border border-border bg-background/60 px-2.5 py-1.5 text-xs font-mono"
                  >
                    <span className="truncate flex items-center gap-1.5">
                      <FileText className="h-3 w-3" />
                      {f.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand text-brand-foreground font-semibold px-4 py-3 hover:opacity-95 disabled:opacity-50 transition shadow-glow"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> {progress || "Готовим…"}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> Оценить готовность
                </>
              )}
            </button>
          </div>

          <aside className="lg:col-span-2 rounded-2xl border border-border bg-card/50 p-5 text-sm">
            <div className="font-display text-lg mb-2">Что проверяет ИИ</div>
            <ul className="space-y-1.5 text-muted-foreground text-[13px]">
              <li>1. Ясность цели</li>
              <li>2. Определены участники и ответственные</li>
              <li>3. Структура «сверху вниз»</li>
              <li>4. Письменная подготовка</li>
              <li>5. Учтены вопросы и возражения</li>
              <li>6. Приходит с решением, не проблемой</li>
              <li>7. Готовность ≠ нет совещания</li>
              <li>8. Время на обдумывание</li>
              <li>9. Готовятся все участники</li>
            </ul>
          </aside>
        </div>

        <section className="mt-16">
          <h2 className="font-display text-2xl mb-4">Подготовки</h2>
          {list.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Пока пусто. Создайте первую подготовку выше.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {list.map((p) => (
                <Link
                  key={p.id}
                  to="/prepare/$id"
                  params={{ id: p.id }}
                  className="rounded-xl border border-border bg-card/60 hover:bg-card hover:border-brand/40 transition p-4 block"
                >
                  <div className="flex items-center justify-between mb-2">
                    <ScorePill score={p.readiness_score} status={p.status} />
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {new Date(p.created_at).toLocaleDateString("ru-RU")}
                    </span>
                  </div>
                  <div className="font-display text-base line-clamp-2">{p.topic}</div>
                  {p.verdict && (
                    <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      {p.verdict}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}

function ScorePill({ score, status }: { score: number | null; status: string }) {
  if (status === "checking") {
    return (
      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-brand/20 text-brand inline-flex items-center gap-1">
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> Проверка
      </span>
    );
  }
  if (score == null) {
    return (
      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
        Черновик
      </span>
    );
  }
  const cls =
    score >= 70
      ? "bg-success/20 text-success"
      : score >= 40
        ? "bg-warn/20 text-warn"
        : "bg-destructive/20 text-destructive";
  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${cls}`}>
      {score}/100
    </span>
  );
}
