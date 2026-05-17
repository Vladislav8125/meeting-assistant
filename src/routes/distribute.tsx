import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { TopNav } from "@/components/TopNav";
import { Footer } from "@/components/Footer";
import { supabase } from "@/integrations/supabase/client";
import { Send, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/distribute")({
  component: DistributeIndex,
  head: () => ({
    meta: [{ title: "Рассылка результатов · meetanalize" }],
  }),
});

type Row = {
  id: string;
  file_name: string;
  topic: string | null;
  created_at: string;
  email_sent_at: string | null;
  distributions: { kind: string; to: string; ok: boolean }[];
};

function DistributeIndex() {
  const [rows, setRows] = useState<Row[]>([]);
  const load = useCallback(() => {
    supabase
      .from("analyses")
      .select("id,file_name,topic,created_at,email_sent_at,distributions")
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (data) setRows(data as unknown as Row[]);
      });
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="min-h-screen flex flex-col bg-background relative">
      <TopNav />
      <main className="relative z-10 max-w-5xl mx-auto px-6 pt-12 pb-24 w-full flex-1">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-brand/15 text-brand flex items-center justify-center">
            <Send className="h-5 w-5" />
          </div>
          <div>
            <div className="font-mono text-xs text-muted-foreground">Шаг 3</div>
            <h1 className="font-display text-3xl font-semibold">Рассылка</h1>
          </div>
        </div>
        <p className="mt-3 text-muted-foreground max-w-2xl">
          Выберите готовый отчёт, чтобы отправить его участникам — полностью,
          резюме, или персональные action items.
        </p>

        <div className="mt-10">
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Пока нет готовых анализов. Сначала загрузите запись на шаге 2.
              <div className="mt-3">
                <Link to="/meeting" className="text-brand font-mono text-xs">→ К совещанию</Link>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => {
                const sentCount = (r.distributions ?? []).filter((d) => d.ok).length;
                return (
                  <Link
                    key={r.id}
                    to="/distribute/$id"
                    params={{ id: r.id }}
                    className="flex items-center gap-4 rounded-xl border border-border bg-card/60 hover:bg-card hover:border-brand/40 transition p-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-display text-base truncate">
                        {r.topic || r.file_name}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">
                        {new Date(r.created_at).toLocaleString("ru-RU")} ·{" "}
                        {sentCount > 0 ? `отправлено: ${sentCount}` : "не отправлено"}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
