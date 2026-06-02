// Матрица 10 этапов подготовки совещания из xlsx
export type MatrixStageDef = {
  key: string;
  title: string;
  weight: number;
  statuses: string[]; // index 0 — худший (часто блокирующий), последний — лучший
};

export const MATRIX_STAGES: MatrixStageDef[] = [
  { key: "goal",         title: "Цель",                     weight: 15, statuses: ["Не определена", "Черновик цели", "Цель уточнена", "Цель утверждена"] },
  { key: "necessity",    title: "Нужность встречи",         weight: 10, statuses: ["Не проверено", "Есть альтернатива", "Совещание обосновано"] },
  { key: "participants", title: "Участники и роли",         weight: 12, statuses: ["Не определены", "Черновой список", "Роли назначены", "Состав утверждён"] },
  { key: "responsible",  title: "Ответственный",            weight: 8,  statuses: ["Не назначен", "Кандидат предложен", "Ответственный назначен"] },
  { key: "structure",    title: "Структура сверху вниз",    weight: 10, statuses: ["Структуры нет", "Черновая структура", "Структура утверждена"] },
  { key: "materials",    title: "Письменные материалы",     weight: 15, statuses: ["Материалов нет", "Черновик материалов", "Готово на проверку", "Финальная версия"] },
  { key: "objections",   title: "Вопросы и возражения",     weight: 8,  statuses: ["Не подготовлены", "Частично подготовлены", "Подготовлены"] },
  { key: "solutions",    title: "Варианты решений",         weight: 12, statuses: ["Только проблема", "Есть 1 вариант", "Есть 2+ варианта", "Выбран рекомендуемый вариант"] },
  { key: "distribution", title: "Рассылка материалов",      weight: 5,  statuses: ["Не разослано", "Разослано", "Получение подтверждено"] },
  { key: "readiness",    title: "Готовность участников",    weight: 5,  statuses: ["Подтверждений нет", "Частичные подтверждения", "Все готовы"] },
];

export type MatrixStage = {
  key: string;
  title: string;
  weight: number;
  status_index: number; // 0..statuses.length-1
  responsible: string;
  due_date: string;
  comment: string;
};

export function makeEmptyStages(): MatrixStage[] {
  return MATRIX_STAGES.map((s) => ({
    key: s.key,
    title: s.title,
    weight: s.weight,
    status_index: 0,
    responsible: "",
    due_date: "",
    comment: "",
  }));
}

export function getStatusLabel(key: string, idx: number): string {
  const def = MATRIX_STAGES.find((s) => s.key === key);
  return def?.statuses[idx] ?? "—";
}

export function stageScorePct(key: string, idx: number): number {
  const def = MATRIX_STAGES.find((s) => s.key === key);
  if (!def) return 0;
  const max = def.statuses.length - 1;
  if (max <= 0) return 100;
  return Math.round((idx / max) * 100);
}

export function isBlocking(key: string, idx: number): boolean {
  // 0-й статус считаем блокирующим (нет цели, не назначены и т.п.)
  return idx === 0;
}

export function summarizeMatrix(stages: MatrixStage[]): {
  readiness_percent: number;
  blocking_count: number;
  verdict_label: string;
} {
  const totalW = stages.reduce((s, st) => s + st.weight, 0) || 1;
  const got = stages.reduce(
    (s, st) => s + (stageScorePct(st.key, st.status_index) / 100) * st.weight,
    0,
  );
  const readiness = Math.round((got / totalW) * 100);
  const blocking = stages.filter((s) => isBlocking(s.key, s.status_index)).length;
  const verdict =
    blocking > 0 || readiness < 60
      ? "НУЖНА ДОРАБОТКА"
      : readiness < 85
      ? "ПОЧТИ ГОТОВО"
      : "ГОТОВО К СОВЕЩАНИЮ";
  return { readiness_percent: readiness, blocking_count: blocking, verdict_label: verdict };
}
