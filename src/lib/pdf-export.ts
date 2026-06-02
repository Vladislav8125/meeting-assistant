// Универсальная клиентская генерация PDF (поддержка кириллицы — встроенный Roboto)
import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import type { TDocumentDefinitions, Content } from "pdfmake/interfaces";
import type { ChecklistItem } from "@/lib/checklist-config";
import type { MatrixStage } from "@/lib/matrix-config";
import { MATRIX_STAGES, getStatusLabel, stageScorePct } from "@/lib/matrix-config";

// vfs_fonts.js exports `module.exports = vfs` directly
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pdfMake as any).vfs = pdfFonts as unknown as Record<string, string>;

const HEADER_FOOTER = {
  styles: {
    h1: { fontSize: 18, bold: true, margin: [0, 0, 0, 6] as [number, number, number, number] },
    h2: { fontSize: 13, bold: true, margin: [0, 12, 0, 6] as [number, number, number, number] },
    muted: { fontSize: 9, color: "#888" },
    pill: { fontSize: 10, bold: true },
  },
  defaultStyle: { fontSize: 10 },
};

function brand(): Content {
  return {
    columns: [
      { text: "meetanalize", bold: true, fontSize: 14 },
      { text: new Date().toLocaleString("ru-RU"), alignment: "right", style: "muted" },
    ],
    margin: [0, 0, 0, 16],
  };
}

export function downloadChecklistPdf(row: {
  topic: string;
  meeting_date: string | null;
  moderator: string | null;
  notes: string | null;
  items: ChecklistItem[];
  score: number;
}) {
  const groups = new Map<number, { title: string; items: ChecklistItem[] }>();
  row.items.forEach((it) => {
    if (!groups.has(it.rule_no)) groups.set(it.rule_no, { title: it.rule_title, items: [] });
    groups.get(it.rule_no)!.items.push(it);
  });

  const body: Content[] = [];
  for (const [no, g] of groups) {
    body.push({
      text: [
        { text: `#${String(no).padStart(2, "0")}  `, color: "#888" },
        { text: g.title, bold: true },
      ],
      margin: [0, 8, 0, 4],
    });
    body.push({
      table: {
        widths: [16, "*", 40],
        body: g.items.map((it) => [
          { text: it.done ? "✓" : "·", alignment: "center", color: it.done ? "#16a34a" : "#888" },
          { text: it.fact },
          { text: `${it.weight}%`, alignment: "right", color: "#888" },
        ]),
      },
      layout: "lightHorizontalLines",
    });
  }

  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 40],
    content: [
      brand(),
      { text: "Чек-лист «Успешное совещание»", style: "h1" },
      { text: row.topic, fontSize: 14, bold: true },
      {
        text: [
          row.meeting_date ? `Дата: ${row.meeting_date}   ` : "",
          row.moderator ? `Модератор: ${row.moderator}` : "",
        ],
        style: "muted",
        margin: [0, 2, 0, 8],
      },
      {
        table: {
          widths: ["*", 80],
          body: [
            [
              { text: "Итоговая оценка", bold: true },
              { text: `${row.score}%`, alignment: "right", bold: true, color: row.score >= 75 ? "#16a34a" : row.score >= 50 ? "#d97706" : "#dc2626" },
            ],
            [
              { text: "Выполнено факт-чеков" },
              { text: `${row.items.filter((i) => i.done).length} / ${row.items.length}`, alignment: "right" },
            ],
          ],
        },
        layout: "lightHorizontalLines",
      },
      ...body,
      ...(row.notes
        ? [
            { text: "Заметки", style: "h2" } as Content,
            { text: row.notes } as Content,
          ]
        : []),
    ],
    ...HEADER_FOOTER,
  };
  pdfMake.createPdf(doc).download(`checklist-${row.topic.slice(0, 40).replace(/[^\w\- ]/g, "_")}.pdf`);
}

export function downloadMatrixPdf(row: {
  topic: string;
  meeting_date: string | null;
  moderator: string | null;
  stages: MatrixStage[];
  readiness_percent: number;
  blocking_count: number;
  verdict_label: string;
}) {
  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [30, 30, 30, 30],
    content: [
      brand(),
      { text: "Подготовка совещания · матрица этапов", style: "h1" },
      { text: row.topic, fontSize: 14, bold: true },
      {
        text: [
          row.meeting_date ? `Дата: ${row.meeting_date}   ` : "",
          row.moderator ? `Модератор: ${row.moderator}` : "",
        ],
        style: "muted",
        margin: [0, 2, 0, 8],
      },
      {
        table: {
          widths: ["*", 60, 60, 100],
          body: [
            [
              { text: "% готовности", bold: true },
              { text: "Блок-этапов", bold: true },
              { text: "Вес·сумма", bold: true },
              { text: "Вердикт", bold: true },
            ],
            [
              { text: `${row.readiness_percent}%`, color: row.readiness_percent >= 85 ? "#16a34a" : row.readiness_percent >= 60 ? "#d97706" : "#dc2626", bold: true },
              { text: String(row.blocking_count), color: row.blocking_count > 0 ? "#dc2626" : "#16a34a" },
              { text: `${row.stages.reduce((s, x) => s + x.weight, 0)} / 100` },
              { text: row.verdict_label, bold: true },
            ],
          ],
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 12],
      },
      {
        table: {
          headerRows: 1,
          widths: [120, 130, 100, 70, "*", 50, 40],
          body: [
            [
              { text: "Этап", bold: true },
              { text: "Статус", bold: true },
              { text: "Ответственный", bold: true },
              { text: "Срок", bold: true },
              { text: "Комментарий", bold: true },
              { text: "Вес", bold: true, alignment: "right" },
              { text: "%", bold: true, alignment: "right" },
            ],
            ...row.stages.map((s) => [
              { text: s.title },
              { text: getStatusLabel(s.key, s.status_index) },
              { text: s.responsible || "—" },
              { text: s.due_date || "—" },
              { text: s.comment || "—" },
              { text: String(s.weight), alignment: "right" as const },
              { text: `${stageScorePct(s.key, s.status_index)}%`, alignment: "right" as const, color: stageScorePct(s.key, s.status_index) >= 75 ? "#16a34a" : "#888" },
            ]),
          ],
        },
        layout: "lightHorizontalLines",
      },
    ],
    ...HEADER_FOOTER,
  };
  // Document order matches matrix definitions:
  void MATRIX_STAGES;
  pdfMake.createPdf(doc).download(`matrix-${row.topic.slice(0, 40).replace(/[^\w\- ]/g, "_")}.pdf`);
}

export function downloadAnalysisPdf(row: {
  topic: string | null;
  file_name: string;
  created_at: string;
  language: string | null;
  participants: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  report: any;
}) {
  const r = row.report ?? {};
  const sections: Content[] = [];
  const list = (title: string, arr?: string[]) => {
    if (!arr || !arr.length) return;
    sections.push({ text: title, style: "h2" });
    sections.push({ ul: arr });
  };

  if (r.verdict) {
    sections.push({ text: "Вердикт", style: "h2" });
    sections.push({ text: r.verdict });
  }
  if (r.summary) {
    sections.push({ text: "Резюме", style: "h2" });
    sections.push({ text: r.summary });
  }
  list("Ключевые тезисы", r.key_points);
  list("Принятые решения", r.decisions);
  if (r.action_items?.length) {
    sections.push({ text: "Action items", style: "h2" });
    sections.push({
      table: {
        headerRows: 1,
        widths: ["*", 100, 80],
        body: [
          [{ text: "Задача", bold: true }, { text: "Ответственный", bold: true }, { text: "Срок", bold: true }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...r.action_items.map((a: any) => [a.task ?? "", a.owner ?? "", a.deadline ?? ""]),
        ],
      },
      layout: "lightHorizontalLines",
    });
  }
  list("Вопросы и возражения", r.questions_objections);
  list("Риски", r.risks);
  list("Рекомендации", r.recommendations);

  if (r.rules_assessment?.length) {
    sections.push({ text: "Оценка по 16 правилам", style: "h2" });
    sections.push({
      table: {
        headerRows: 1,
        widths: [25, "*", 40],
        body: [
          [{ text: "#", bold: true }, { text: "Правило", bold: true }, { text: "Балл", bold: true, alignment: "right" }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...r.rules_assessment.map((x: any) => [String(x.id), x.title ?? "", { text: `${x.score}/10`, alignment: "right" as const }]),
        ],
      },
      layout: "lightHorizontalLines",
    });
  }

  const doc: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 40],
    content: [
      brand(),
      { text: row.topic || row.file_name, style: "h1" },
      {
        text: [
          new Date(row.created_at).toLocaleString("ru-RU"),
          row.language ? `   ·   Язык: ${row.language}` : "",
          row.participants ? `   ·   ${row.participants}` : "",
        ],
        style: "muted",
        margin: [0, 0, 0, 10],
      },
      ...(r.overall_score != null
        ? [
            {
              table: {
                widths: ["*", 80],
                body: [
                  [
                    { text: "Общая оценка", bold: true },
                    {
                      text: `${r.overall_score}/100`,
                      bold: true,
                      alignment: "right" as const,
                      color: r.overall_score >= 75 ? "#16a34a" : r.overall_score >= 50 ? "#d97706" : "#dc2626",
                    },
                  ],
                ],
              },
              layout: "lightHorizontalLines",
              margin: [0, 0, 0, 8] as [number, number, number, number],
            } as Content,
          ]
        : []),
      ...sections,
    ],
    ...HEADER_FOOTER,
  };
  pdfMake.createPdf(doc).download(`analysis-${(row.topic || row.file_name).slice(0, 40).replace(/[^\w\- ]/g, "_")}.pdf`);
}

// Простой CSV-экспорт журнала
export function downloadJournalCsv(rows: Record<string, string | number | null>[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "\uFEFF" + [keys.join(";"), ...rows.map((r) => keys.map((k) => esc(r[k])).join(";"))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `meetanalize-journal-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
