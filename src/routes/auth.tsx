import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Footer } from "@/components/Footer";
import { Loader2, Mail, Lock, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  head: () => ({ meta: [{ title: "Вход · meetanalize" }] }),
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active && data.user) navigate({ to: "/app/checklist", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) navigate({ to: "/app/checklist", replace: true });
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return toast.error("Введите email и пароль");
    if (password.length < 6) return toast.error("Пароль минимум 6 символов");
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/app/checklist" },
        });
        if (error) throw error;
        toast.success("Аккаунт создан. Входим…");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-40 pointer-events-none" />
      <div className="absolute inset-0 bg-hero pointer-events-none" />
      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <Link to="/" className="flex items-center gap-2 mb-8">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand to-accent-2 shadow-glow" />
            <span className="font-display text-xl font-semibold">meetanalize</span>
          </Link>
          <div className="rounded-2xl border border-border bg-card/70 backdrop-blur p-7 shadow-glow">
            <h1 className="font-display text-2xl">
              {mode === "login" ? "Вход в личный кабинет" : "Регистрация"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {mode === "login"
                ? "Войдите, чтобы продолжить работу с совещаниями."
                : "Создайте аккаунт за 10 секунд."}
            </p>
            <form onSubmit={submit} className="mt-6 space-y-3">
              <div className="relative">
                <Mail className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full rounded-lg bg-input/40 border border-border pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/60"
                  disabled={busy}
                />
              </div>
              <div className="relative">
                <Lock className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
                <input
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Пароль"
                  className="w-full rounded-lg bg-input/40 border border-border pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/60"
                  disabled={busy}
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand text-brand-foreground font-semibold px-4 py-2.5 hover:opacity-95 disabled:opacity-50 transition shadow-glow"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {mode === "login" ? "Войти" : "Создать аккаунт"}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setMode((m) => (m === "login" ? "signup" : "login"))}
              className="mt-5 w-full text-center text-sm text-muted-foreground hover:text-foreground"
            >
              {mode === "login" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
            </button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
