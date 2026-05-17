// Server fns for post-meeting distribution: send report/summary/action items.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function getAdmin() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("Supabase env not configured");
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const FormatEnum = z.enum(["full", "summary", "actions"]);

export const sendReport = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        analysisId: z.string().uuid(),
        recipients: z.array(z.string().email().max(200)).min(1).max(20),
        format: FormatEnum.default("full"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const admin = await getAdmin();
    const { sendAnalysisReport } = await import("@/lib/email-report.server");
    const results: { to: string; ok: boolean; error?: string }[] = [];
    for (const to of data.recipients) {
      const r = await sendAnalysisReport(admin, data.analysisId, to, data.format);
      results.push({ to, ok: r.ok, error: r.error });
      await admin.rpc("append_analysis_distribution", {
        _id: data.analysisId,
        _entry: {
          ts: new Date().toISOString(),
          kind: "report",
          format: data.format,
          to,
          ok: r.ok,
          error: r.error ?? null,
        } as never,
      });
    }
    return { ok: results.every((r) => r.ok), results };
  });

export const sendActionItemsToParticipants = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        analysisId: z.string().uuid(),
        assignments: z
          .array(
            z.object({
              label: z.string().min(1).max(200),
              email: z.string().email().max(200),
            }),
          )
          .min(1)
          .max(50),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const admin = await getAdmin();
    const { sendActionItemsEmail } = await import("@/lib/email-report.server");

    // Persist participant_emails mapping for future re-runs
    await admin
      .from("analyses")
      .update({ participant_emails: data.assignments as never })
      .eq("id", data.analysisId);

    const results: { to: string; label: string; ok: boolean; error?: string; count: number }[] = [];
    for (const a of data.assignments) {
      const r = await sendActionItemsEmail(admin, data.analysisId, a.label, a.email);
      results.push({ to: a.email, label: a.label, ok: r.ok, error: r.error, count: r.count ?? 0 });
      await admin.rpc("append_analysis_distribution", {
        _id: data.analysisId,
        _entry: {
          ts: new Date().toISOString(),
          kind: "action_items",
          label: a.label,
          to: a.email,
          count: r.count ?? 0,
          ok: r.ok,
          error: r.error ?? null,
        } as never,
      });
    }
    return { ok: results.every((r) => r.ok), results };
  });
