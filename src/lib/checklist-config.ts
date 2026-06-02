// 16 правил / 25 факт-чеков из "ЧЕК-ЛИСТ Успешное Совещание"
// weight в процентах; sum = 100
export type ChecklistTemplateItem = {
  rule_no: number;
  rule_title: string;
  fact: string;
  weight: number;
};

export type ChecklistItem = ChecklistTemplateItem & { done: boolean };

export const CHECKLIST_TEMPLATE: ChecklistTemplateItem[] = [
  { rule_no: 1, rule_title: "Определи цель", fact: "Прописана Цель совещания", weight: 5 },
  { rule_no: 2, rule_title: "Определи участников и ответственных", fact: "Участники оповещены не позднее чем накануне", weight: 3 },
  { rule_no: 2, rule_title: "Определи участников и ответственных", fact: "Ответственный назначен заранее", weight: 2 },
  { rule_no: 3, rule_title: "Сверху вниз. От крупного к мелкому", fact: "Задачи решали и планировали сверху вниз, от крупного к мелкому", weight: 5 },
  { rule_no: 4, rule_title: "Письменная подготовка", fact: "Письменные материалы предоставлены до совещания", weight: 6 },
  { rule_no: 5, rule_title: "Учти вопросы и возражения заранее", fact: "Подготовлены ответы на возможные вопросы и возражения, подробности расчётов", weight: 3 },
  { rule_no: 6, rule_title: "Не приходи с проблемой — приходи с решением", fact: "На поднятую проблему подготовлено решение", weight: 3 },
  { rule_no: 6, rule_title: "Не приходи с проблемой — приходи с решением", fact: "Подготовлено несколько вариантов решения", weight: 3 },
  { rule_no: 7, rule_title: "Нет подготовки — нет совещания", fact: "Есть письменная подготовка", weight: 5 },
  { rule_no: 8, rule_title: "Дай время обдумать", fact: "Письменные материалы предоставлены за сутки", weight: 3 },
  { rule_no: 9, rule_title: "Готовятся все участники", fact: "Все участники прочитали материалы до совещания", weight: 4 },
  { rule_no: 9, rule_title: "Готовятся все участники", fact: "Все участники письменно подготовили вопросы и замечания", weight: 4 },
  { rule_no: 10, rule_title: "Говори коротко", fact: "Соблюдался регламент 30 секунд на вопрос или замечание", weight: 3 },
  { rule_no: 10, rule_title: "Говори коротко", fact: "Отвечаем на вопрос по существу: цифра или факт", weight: 2 },
  { rule_no: 10, rule_title: "Говори коротко", fact: "Не было длинных вступлений", weight: 2 },
  { rule_no: 10, rule_title: "Говори коротко", fact: "Не было длинных перечислений", weight: 2 },
  { rule_no: 11, rule_title: "Не уходи от темы", fact: "Не было затрат времени на отвлечения от темы", weight: 5 },
  { rule_no: 12, rule_title: "Оперируй фактами. Избегай манипуляций", fact: "Эмоции вместо факта не применялись", weight: 2 },
  { rule_no: 12, rule_title: "Оперируй фактами. Избегай манипуляций", fact: "Домыслы под видом факта не подавались", weight: 2 },
  { rule_no: 12, rule_title: "Оперируй фактами. Избегай манипуляций", fact: "Не было искажения информации", weight: 2 },
  { rule_no: 12, rule_title: "Оперируй фактами. Избегай манипуляций", fact: "Не было подмены показателей или задач", weight: 2 },
  { rule_no: 13, rule_title: "Следи за временем", fact: "Совещание начато вовремя в полном составе", weight: 3 },
  { rule_no: 13, rule_title: "Следи за временем", fact: "На каждый пункт повестки рассчитано время", weight: 3 },
  { rule_no: 13, rule_title: "Следи за временем", fact: "Регламент по времени соблюдён", weight: 5 },
  { rule_no: 14, rule_title: "Фиксируй принятые решения", fact: "Опубликованы итоги совещания в течение часа", weight: 5 },
  { rule_no: 14, rule_title: "Фиксируй принятые решения", fact: "Решения поставлены в планы в течение часа", weight: 5 },
  { rule_no: 15, rule_title: "Принятые решения обязательны к исполнению", fact: "Решения не игнорируются. При необходимости изменения — согласовано", weight: 3 },
  { rule_no: 15, rule_title: "Принятые решения обязательны к исполнению", fact: "Проконтролировано выполнение в срок", weight: 3 },
  { rule_no: 16, rule_title: "Инвестируй сэкономленное время", fact: "Часть сэкономленного времени потрачено на то, чтобы стать счастливее", weight: 5 },
];

export function makeEmptyItems(): ChecklistItem[] {
  return CHECKLIST_TEMPLATE.map((t) => ({ ...t, done: false }));
}

export function computeScore(items: ChecklistItem[]): number {
  const total = items.reduce((s, i) => s + i.weight, 0) || 1;
  const got = items.reduce((s, i) => s + (i.done ? i.weight : 0), 0);
  return Math.round((got / total) * 100);
}
