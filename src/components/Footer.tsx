export function Footer() {
  return (
    <footer className="relative z-10 border-t border-border mt-auto">
      <div className="max-w-6xl mx-auto px-6 py-6 text-xs text-muted-foreground font-mono">
        © {new Date().getFullYear()} meetanalize · эффективное совещание
      </div>
    </footer>
  );
}
