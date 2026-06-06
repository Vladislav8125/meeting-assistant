// Матрица 10 этапов подготовки совещания + критерии для AI
export type MatrixStageDef = {
  key: string;
  title: string;
  weight: number;
  statuses: string[]; // index 0 — худший (часто блокирующий), последний — лучший
  criteria: string;   // что искать в материалах, чтобы поставить статус
};

export const MATRIX_STAGES: MatrixStageDef[] = [
  {
    key: "goal", title: "Цель", weight: 15,
    statuses: ["Не определена", "Черновик цели", "Цель уточнена", "Цель утверждена"],
    criteria:
      "0 — в материалах нет явной формулировки цели; " +
      "1 — цель упомянута размыто, без измеримого результата; " +
      "2 — цель сформулирована конкретно (SMART), указан ожидаемый итог; " +
      "3 — явно указано, что цель согласована/утверждена заказчиком или руководителем.",
  },
  {
    key: "necessity", title: "Нужность встречи", weight: 10,
    statuses: ["Не проверено", "Есть альтернатива", "Совещание обосновано"],
    criteria:
      "0 — нет обоснования, зачем встреча именно живая; " +
      "1 — задачу можно было решить перепиской/документом, есть очевидная альтернатива; " +
      "2 — явно обосновано, почему нужна синхронная встреча (решение, согласование, конфликт).",
  },
  {
    key: "participants", title: "Участники и роли", weight: 12,
    statuses: ["Не определены", "Черновой список", "Роли назначены", "Состав утверждён"],
    criteria:
      "0 — нет списка участников; " +
      "1 — есть имена/должности без ролей; " +
      "2 — у каждого участника указана роль (докладчик, ЛПР, эксперт, наблюдатель); " +
      "3 — состав явно утверждён, конфликта по списку нет.",
  },
  {
    key: "responsible", title: "Ответственный", weight: 8,
    statuses: ["Не назначен", "Кандидат предложен", "Ответственный назначен"],
    criteria:
      "0 — нет модератора/инициатора; 1 — упомянут возможный ответственный; " +
      "2 — явно назначен модератор/инициатор встречи с ФИО.",
  },
  {
    key: "structure", title: "Структура сверху вниз", weight: 10,
    statuses: ["Структуры нет", "Черновая структура", "Структура утверждена"],
    criteria:
      "0 — нет повестки/структуры; " +
      "1 — есть набросок пунктов без иерархии/тайминга; " +
      "2 — повестка построена сверху вниз (главный вывод → детали), есть тайминг по пунктам.",
  },
  {
    key: "materials", title: "Письменные материалы", weight: 15,
    statuses: ["Материалов нет", "Черновик материалов", "Готово на проверку", "Финальная версия"],
    criteria:
      "0 — нет письменных материалов вообще; " +
      "1 — есть черновой документ/презентация без оформления; " +
      "2 — материалы оформлены, но не помечены как финальные; " +
      "3 — явно финальная версия (versioning, помечено final/v1.0 и т.п.).",
  },
  {
    key: "objections", title: "Вопросы и возражения", weight: 8,
    statuses: ["Не подготовлены", "Частично подготовлены", "Подготовлены"],
    criteria:
      "0 — нет анализа возможных вопросов/возражений; " +
      "1 — упомянуты 1-2 риска без ответов; " +
      "2 — есть раздел Q&A / FAQ / возражения с заготовленными ответами.",
  },
  {
    key: "solutions", title: "Варианты решений", weight: 12,
    statuses: ["Только проблема", "Есть 1 вариант", "Есть 2+ варианта", "Выбран рекомендуемый вариант"],
    criteria:
      "0 — описана только проблема, без вариантов решения; " +
      "1 — предложен один вариант решения; " +
      "2 — рассмотрены 2 и более варианта с плюсами/минусами; " +
      "3 — есть рекомендуемый вариант с обоснованием выбора.",
  },
  {
    key: "distribution", title: "Рассылка материалов", weight: 5,
    statuses: ["Не разослано", "Разослано", "Получение подтверждено"],
    criteria:
      "0 — нет упоминания рассылки участникам; " +
      "1 — указано, что материалы разосланы заранее; " +
      "2 — есть подтверждения от участников о получении/ознакомлении.",
  },
  {
    key: "readiness", title: "Готовность участников", weight: 5,
    statuses: ["Подтверждений нет", "Частичные подтверждения", "Все готовы"],
    criteria:
      "0 — нет подтверждений участия/подготовки; " +
      "1 — часть участников подтвердила; " +
      "2 — все участники подтвердили готовность и ознакомились с материалами.",
  },
];

export type MatrixStage = {
  key: string;
  title: string;
  weight: number;
  status_index: number; // 0..statuses.length-1
  responsible: string;
  due_date: string;
  comment: string;
  source?: "ai" | "manual";
  confidence?: number;
  rationale?: string;
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
    source: "manual",
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
