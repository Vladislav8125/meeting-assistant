// Server-only helper to append structured logs to an analysis row.
import type { SupabaseClient } from "@supabase/supabase-js";

export type LogLevel = "info" | "warn" | "error";

export type LogEntry = {
  ts: string;
  source: string; // e.g. "assemblyai", "webhook", "pipeline"
  level: LogLevel;
  message: string;
  data?: unknown;
};

function safeTrim(value: unknown, max = 4000): unknown {
  if (typeof value === "string") {
    return value.length > max ? value.slice(0, max) + "…[trimmed]" : value;
  }
  if (value && typeof value === "object") {
    try {
      const s = JSON.stringify(value);
      if (s.length <= max) return value;
      return s.slice(0, max) + "…[trimmed]";
    } catch {
      return String(value).slice(0, max);
    }
  }
  return value;
}

export async function logAnalysis(
  admin: SupabaseClient,
  analysisId: string,
  source: string,
  level: LogLevel,
  message: string,
  data?: unknown,
): Promise<void> {
  try {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      source,
      level,
      message: typeof message === "string" ? message.slice(0, 1000) : String(message),
      data: data === undefined ? undefined : safeTrim(data),
    };
    await admin.rpc("append_analysis_log", {
      _id: analysisId,
      _entry: entry as never,
    });
  } catch (e) {
    // Never let logging break the pipeline
    console.error("logAnalysis failed", e);
  }
}

// Detect language from transcript text by Cyrillic ratio.
export function detectLanguage(text: string): string {
  if (!text) return "unknown";
  let cyr = 0;
  let lat = 0;
  for (const ch of text) {
    if (/[а-яёА-ЯЁ]/.test(ch)) cyr++;
    else if (/[a-zA-Z]/.test(ch)) lat++;
  }
  const total = cyr + lat;
  if (total < 20) return "unknown";
  if (cyr / total > 0.3) return "ru";
  if (lat / total > 0.7) return "en";
  return "mixed";
}
