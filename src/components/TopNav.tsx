import { Link } from "@tanstack/react-router";
import { ClipboardCheck, Mic, Send, Sparkles } from "lucide-react";

const links = [
  { to: "/prepare", label: "1 · Подготовка", icon: ClipboardCheck },
  { to: "/meeting", label: "2 · Совещание", icon: Mic },
  { to: "/distribute", label: "3 · Рассылка", icon: Send },
] as const;

export function TopNav() {
  return (
    <header className="relative z-20 border-b border-border bg-background/70 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-6">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-brand to-accent-2 shadow-glow" />
          <span className="font-display text-base font-semibold">meetanalize</span>
        </Link>
        <nav className="flex items-center gap-1 overflow-x-auto">
          {links.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeProps={{ className: "bg-brand/15 text-brand border-brand/30" }}
              inactiveProps={{ className: "text-muted-foreground hover:text-foreground border-transparent" }}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-mono transition whitespace-nowrap"
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-card/40 px-2.5 py-1 text-[10px] font-mono text-muted-foreground">
          <Sparkles className="h-3 w-3 text-accent-2" />
          эффективное совещание
        </div>
      </div>
    </header>
  );
}
