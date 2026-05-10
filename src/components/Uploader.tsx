import { useCallback, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { analyzeRecording } from "@/lib/analyze.functions";
import { Upload, Loader2, FileAudio, FileVideo } from "lucide-react";
import { toast } from "sonner";

const ACCEPTED = ["audio/", "video/"];
const MAX_BYTES = 200 * 1024 * 1024; // 200 MB practical limit for base64 path

export function Uploader() {
  const [file, setFile] = useState<File | null>(null);
  const [topic, setTopic] = useState("");
  const [participants, setParticipants] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [lastId, setLastId] = useState<string | null>(null);

  const onPick = useCallback((f: File | null) => {
    if (!f) return;
    if (!ACCEPTED.some((a) => f.type.startsWith(a))) {
      toast.error("Поддерживаются только аудио или видео файлы");
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error("Файл больше 200 МБ. Загрузите запись поменьше для MVP.");
      return;
    }
    setFile(f);
  }, []);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      setProgress("Загружаю файл…");
      const path = `uploads/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage
        .from("media")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("media").getPublicUrl(path);

      setProgress("Создаю запись…");
      const { data: row, error: insErr } = await supabase
        .from("analyses")
        .insert({
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          storage_path: path,
          topic: topic || null,
          participants: participants || null,
          recipient_email: email || null,
          status: "pending",
        })
        .select()
        .single();
      if (insErr || !row) throw insErr ?? new Error("insert failed");

      setProgress("Отправляю в Fireflies на транскрибацию…");
      try {
        await analyzeRecording({
          data: {
            analysisId: row.id,
            publicUrl: pub.publicUrl,
            mimeType: file.type,
            topic: topic || undefined,
            participants: participants || undefined,
            recipientEmail: email || undefined,
          },
        });
        toast.success(
          email
            ? "Запись отправлена. Отчёт придёт на почту по готовности (5–15 мин)."
            : "Запись отправлена. Транскрибация занимает 5–15 минут.",
        );
      } catch (e) {
        console.error(e);
        const msg = e instanceof Error ? e.message : "ошибка";
        toast.error("Не удалось запустить анализ: " + msg);
      }

      // Не редиректим — показываем ссылку на отчёт прямо здесь
      setLastId(row.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
      toast.error(msg);
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const Icon = file?.type.startsWith("video/") ? FileVideo : FileAudio;

  return (
    <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-md p-6 sm:p-8 shadow-glow">
      <label
        className="group relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border hover:border-brand/60 transition-colors p-10 cursor-pointer text-center"
        htmlFor="file-input"
      >
        <input
          id="file-input"
          type="file"
          accept="audio/*,video/*"
          className="sr-only"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          disabled={busy}
        />
        {file ? (
          <>
            <Icon className="h-10 w-10 text-brand" />
            <div className="font-mono text-sm">{file.name}</div>
            <div className="text-xs text-muted-foreground">
              {(file.size / 1024 / 1024).toFixed(1)} МБ · {file.type || "медиа"}
            </div>
          </>
        ) : (
          <>
            <Upload className="h-10 w-10 text-muted-foreground group-hover:text-brand transition-colors" />
            <div className="font-display text-lg">
              Перетащите файл или нажмите
            </div>
            <div className="text-xs text-muted-foreground">
              MP3, WAV, M4A, MP4, MOV — до 200 МБ
            </div>
          </>
        )}
      </label>

      <div className="grid sm:grid-cols-2 gap-3 mt-6">
        <input
          className="rounded-lg bg-input/40 border border-border px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/60"
          placeholder="Тема встречи (опц.)"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          maxLength={500}
          disabled={busy}
        />
        <input
          className="rounded-lg bg-input/40 border border-border px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/60"
          placeholder="Участники, через запятую"
          value={participants}
          onChange={(e) => setParticipants(e.target.value)}
          maxLength={1000}
          disabled={busy}
        />
      </div>

      <input
        type="email"
        className="mt-3 w-full rounded-lg bg-input/40 border border-border px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/60"
        placeholder="Email для отчёта (опц.)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        maxLength={200}
        disabled={busy}
      />

      <button
        type="button"
        onClick={submit}
        disabled={!file || busy}
        className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand text-brand-foreground font-semibold px-4 py-3 hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-glow"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> {progress || "Готовим…"}
          </>
        ) : (
          <>Анализировать запись</>
        )}
      </button>
      {lastId && !busy && (
        <Link
          to="/analysis/$id"
          params={{ id: lastId }}
          className="mt-4 block text-center rounded-lg border border-brand/40 bg-brand/10 text-brand px-4 py-2.5 text-sm font-mono hover:bg-brand/20 transition"
        >
          Открыть отчёт →
        </Link>
      )}
      <p className="text-[11px] text-muted-foreground mt-3 text-center">
        Транскрибация и анализ выполняются на сервере через Lovable AI. Файл
        будет доступен только по ссылке отчёта.
      </p>
    </div>
  );
}
