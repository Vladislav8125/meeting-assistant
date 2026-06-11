import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Save, Loader2, FileDown, Trash2, Sparkles, Upload, X, FileText, History } from "lucide-react";
import { toast } from "sonner";
import {
  MATRIX_STAGES,
  type MatrixStage,
  summarizeMatrix,
  stageScorePct,
  isBlocking,
  getStatusLabel,
} from "@/lib/matrix-config";
import { downloadMatrixPdf } from "@/lib/pdf-export";
import { analyzeMatrix } from "@/lib/matrix-ai.functions";

type LogEntry = {
  ts: string;
  source?: string;
  level?: string;
  message?: string;
  user_email?: string;
  data?: Record<string, unknown>;
};

export const Route = createFileRoute("/_authenticated/app/matrix/$id")({
  component: MatrixDetail,
});

type Row = {
  id: string;
  topic: string;
  meeting_date: string | null;
  moderator: string | null;
  stages: MatrixStage[];
  logs: LogEntry[];
};

type UploadedFile = { path: string; name: string; size: number };

const ACCEPTED = ".txt,.md,.csv,.docx";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 10;

function MatrixDetail() {
  const { id } = Route.useParams();
  const [row, setRow] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const baselineRef = useRef<MatrixStage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase
      .from("meeting_preparations")
      .select("id,topic,meeting_date,moderator,stages,logs")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        const r = data as Row | null;
        if (r) {
          baselineRef.current = JSON.parse(JSON.stringify(r.stages));
          setRow({ ...r, logs: (r.logs ?? []) as LogEntry[] });
        }
      });
  }, [id]);

  const summary = useMemo(() => (row ? summarizeMatrix(row.stages) : null), [row]);

  if (!row || !summary) {
    return (
      <div className="p-8 text-muted-foreground inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
      </div>
    );
  }

  const setStage = (i: number, patch: Partial<MatrixStage>) =>
    setRow((r) =>
      r
        ? {
            ...r,
            stages: r.stages.map((s, idx) =>
              idx === i ? { ...s, ...patch, source: patch.status_index !== undefined ? "manual" : s.source } : s,
            ),
          }
        : r,
    );

  const save = async () => {
    setSaving(true);
    const sum = summarizeMatrix(row.stages);
    const { data: u } = await supabase.auth.getUser();
    const userEmail = u.user?.email ?? "unknown";

    // Diff stages vs baseline → audit entries
    const baseline = baselineRef.current;
    const newEntries: LogEntry[] = [];
    row.stages.forEach((s, idx) => {
      const b = baseline[idx];
      if (!b || b.key !== s.key) return;
      const statusChanged = b.status_index !== s.status_index;
      const sourceChanged = (b.source ?? "manual") !== (s.source ?? "manual");
      if (statusChanged || sourceChanged) {
        newEntries.push({
          ts: new Date().toISOString(),
          source: "user",
          level: "info",
          user_email: userEmail,
          message: `Статус «${s.title}»: ${(b.source ?? "manual").toUpperCase()} «${getStatusLabel(s.key, b.status_index)}» → ${(s.source ?? "manual").toUpperCase()} «${getStatusLabel(s.key, s.status_index)}»`,
          data: {
            stage_key: s.key,
            from_status: b.status_index,
            to_status: s.status_index,
            from_source: b.source ?? "manual",
            to_source: s.source ?? "manual",
          },
        });
      }
    });

    const { error } = await supabase
      .from("meeting_preparations")
      .update({
        topic: row.topic,
        meeting_date: row.meeting_date || null,
        moderator: row.moderator,
        stages: row.stages as never,
        ...sum,
      })
      .eq("id", id);

    if (!error) {
      for (const entry of newEntries) {
        await supabase.rpc("append_preparation_log", { _id: id, _entry: entry as never });
      }
      baselineRef.current = JSON.parse(JSON.stringify(row.stages));
      setRow((r) => (r ? { ...r, logs: [...r.logs, ...newEntries] } : r));
    }

    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success(`Сохранено · ${sum.readiness_percent}%${newEntries.length ? ` · ${newEntries.length} изм.` : ""}`);
  };

  const remove = async () => {
    if (!confirm("Удалить запись подготовки?")) return;
    await supabase.from("meeting_preparations").delete().eq("id", id);
    window.location.href = "/app/matrix";
  };


  const handleFiles = async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    if (files.length + picked.length > MAX_FILES) {
      toast.error(`Максимум ${MAX_FILES} файлов`);
      return;
    }
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Войдите в аккаунт");
      const added: UploadedFile[] = [];
      for (const f of Array.from(picked)) {
        if (f.size > MAX_FILE_BYTES) {
          toast.error(`${f.name}: больше 5 МБ`);
          continue;
        }
        const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${u.user.id}/matrix/${id}/${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabase.storage
          .from("media")
          .upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false });
        if (error) {
          toast.error(`${f.name}: ${error.message}`);
          continue;
        }
        added.push({ path, name: f.name, size: f.size });
      }
      setFiles((prev) => [...prev, ...added]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeFile = async (path: string) => {
    await supabase.storage.from("media").remove([path]);
    setFiles((prev) => prev.filter((f) => f.path !== path));
  };

  const runAnalyze = async () => {
    if (!freeText.trim() && files.length === 0) {
      toast.error("Загрузите хотя бы один файл или опишите подготовку текстом");
      return;
    }
    setAnalyzing(true);
    try {
      const res = await analyzeMatrix({
        data: {
          preparation_id: id,
          storage_paths: files.map((f) => f.path),
          free_text: freeText,
        },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const byKey = new Map(res.stages.map((s) => [s.key, s] as const));
      setRow((r) =>
        r
          ? {
              ...r,
              stages: r.stages.map((s) => {
                const ai = byKey.get(s.key);
                if (!ai) return s;
                return {
                  ...s,
                  status_index: ai.status_index,
                  source: "ai" as const,
                  confidence: ai.confidence,
                  rationale: ai.rationale,
                  comment: s.comment || ai.rationale || "",
                };
              }),
            }
          : r,
      );
      toast.success(`AI оценил ${res.stages.length} этапов. Проверьте и заполните ответственных.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка анализа");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <Link to="/app/matrix" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> К списку
      </Link>

      <div className="mt-4 grid lg:grid-cols-[1fr_280px] gap-6 items-start">
        <div>
          <input
            value={row.topic}
            onChange={(e) => setRow({ ...row, topic: e.target.value })}
            className="w-full font-display text-2xl bg-transparent border-b border-border focus:outline-none focus:border-brand pb-1"
            maxLength={500}
          />
          <div className="mt-3 grid sm:grid-cols-3 gap-2">
            <input
              type="date"
              value={row.meeting_date ?? ""}
              onChange={(e) => setRow({ ...row, meeting_date: e.target.value || null })}
              className="rounded-lg bg-input/40 border border-border px-3 py-2 text-sm"
            />
            <input
              placeholder="Модератор / инициатор"
              value={row.moderator ?? ""}
              onChange={(e) => setRow({ ...row, moderator: e.target.value })}
              className="sm:col-span-2 rounded-lg bg-input/40 border border-border px-3 py-2 text-sm"
              maxLength={200}
            />
          </div>
        </div>
        <aside className="rounded-2xl border border-border bg-card/60 p-5 text-center">
          <div
            className={`font-display text-5xl font-semibold ${
              summary.readiness_percent >= 85
                ? "text-success"
                : summary.readiness_percent >= 60
                ? "text-warn"
                : "text-destructive"
            }`}
          >
            {summary.readiness_percent}<span className="text-xl text-muted-foreground">%</span>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Готовность</div>
          <div className="text-xs mt-2">
            Блокирующих: <b className={summary.blocking_count > 0 ? "text-destructive" : ""}>{summary.blocking_count}</b>
          </div>
          <div className="mt-2 font-mono text-[11px]">{summary.verdict_label}</div>
          <div className="mt-4 grid gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand text-brand-foreground px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Сохранить
            </button>
            <button
              onClick={() => downloadMatrixPdf({ ...row, ...summary })}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card hover:bg-accent/40 px-3 py-2 text-sm"
            >
              <FileDown className="h-4 w-4" /> Скачать PDF
            </button>
            <button
              onClick={remove}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 px-3 py-2 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5" /> Удалить
            </button>
          </div>
        </aside>
      </div>

      {/* AI-анализ материалов */}
      <section className="mt-8 rounded-2xl border border-brand/30 bg-brand/5 p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-display text-lg inline-flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-brand" /> Автоматическая оценка по материалам
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
              Загрузите повестку, материалы или опишите подготовку текстом. AI сам проставит статусы по 10 этапам.
              Ответственных и сроки заполните вручную — их нельзя надёжно вывести из документов.
            </p>
          </div>
          <button
            onClick={runAnalyze}
            disabled={analyzing || uploading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand text-brand-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {analyzing ? "Анализирую…" : "Проанализировать"}
          </button>
        </div>

        <div className="mt-4 grid md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Файлы</label>
            <label
              htmlFor="matrix-files"
              className="mt-2 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border hover:border-brand/60 cursor-pointer p-5 text-center transition-colors"
            >
              <input
                id="matrix-files"
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED}
                className="sr-only"
                onChange={(e) => handleFiles(e.target.files)}
                disabled={uploading || analyzing}
              />
              <Upload className="h-6 w-6 text-muted-foreground" />
              <div className="text-sm">{uploading ? "Загружаю…" : "Перетащите или выберите файлы"}</div>
              <div className="text-[11px] text-muted-foreground">TXT, MD, CSV, DOCX · до 5 МБ · до {MAX_FILES} шт.</div>
            </label>
            {files.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {files.map((f) => (
                  <li
                    key={f.path}
                    className="flex items-center gap-2 text-xs rounded-md border border-border bg-card/60 px-2.5 py-1.5"
                  >
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate font-mono">{f.name}</span>
                    <span className="text-muted-foreground">{(f.size / 1024).toFixed(0)} КБ</span>
                    <button
                      type="button"
                      onClick={() => removeFile(f.path)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground">Свободный текст</label>
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="Опишите цель, повестку, участников, ожидаемое решение, статус подготовки материалов…"
              className="mt-2 w-full rounded-xl bg-input/40 border border-border px-3 py-2.5 text-sm h-44 resize-none focus:outline-none focus:ring-2 focus:ring-brand/60"
              maxLength={30_000}
              disabled={analyzing}
            />
            <div className="text-[11px] text-muted-foreground text-right mt-1">{freeText.length} / 30 000</div>
          </div>
        </div>
      </section>

      <section className="mt-8 rounded-2xl border border-border bg-card/60 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-background/50 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Этап</th>
              <th className="px-3 py-2 w-56">Статус</th>
              <th className="px-3 py-2">Ответственный</th>
              <th className="px-3 py-2 w-36">Срок</th>
              <th className="px-3 py-2">Комментарий</th>
              <th className="px-3 py-2 text-right">Вес · Оценка</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {row.stages.map((s, i) => {
              const def = MATRIX_STAGES.find((d) => d.key === s.key)!;
              const pct = stageScorePct(s.key, s.status_index);
              const blocking = isBlocking(s.key, s.status_index);
              const isAI = s.source === "ai";
              return (
                <tr key={s.key} className={blocking ? "bg-destructive/5" : ""}>
                  <td className="px-3 py-2 font-medium align-top">
                    <div>{s.title}</div>
                    {s.rationale && (
                      <div className="text-[11px] font-normal text-muted-foreground mt-1 max-w-xs">
                        {s.rationale}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-1.5">
                      <select
                        value={s.status_index}
                        onChange={(e) => setStage(i, { status_index: Number(e.target.value) })}
                        className="flex-1 rounded-md bg-input/40 border border-border px-2 py-1.5 text-sm"
                      >
                        {def.statuses.map((st, idx) => (
                          <option key={idx} value={idx}>{st}</option>
                        ))}
                      </select>
                      <span
                        className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded ${
                          isAI ? "bg-brand/20 text-brand" : "bg-muted text-muted-foreground"
                        }`}
                        title={isAI ? `AI · уверенность ${Math.round((s.confidence ?? 0) * 100)}%` : "Введено вручную"}
                      >
                        {isAI ? "AI" : "MAN"}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      value={s.responsible}
                      onChange={(e) => setStage(i, { responsible: e.target.value })}
                      className="w-full rounded-md bg-input/40 border border-border px-2 py-1.5 text-sm"
                      maxLength={200}
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      type="date"
                      value={s.due_date}
                      onChange={(e) => setStage(i, { due_date: e.target.value })}
                      className="w-full rounded-md bg-input/40 border border-border px-2 py-1.5 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <input
                      value={s.comment}
                      onChange={(e) => setStage(i, { comment: e.target.value })}
                      className="w-full rounded-md bg-input/40 border border-border px-2 py-1.5 text-sm"
                      maxLength={500}
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs align-top">
                    {s.weight} ·{" "}
                    <span className={pct >= 85 ? "text-success" : pct >= 50 ? "text-warn" : "text-destructive"}>
                      {pct}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
