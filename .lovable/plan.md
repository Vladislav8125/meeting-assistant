# Автоматизация матрицы готовности (Стадия 2)

Сейчас пользователь вручную выбирает статус для каждого из 10 этапов. Заменим это на загрузку документов + один AI-вызов, который вернёт статусы по всем этапам сразу. Пользователю останется только проверить и заполнить организационные поля (ответственный, срок).

## Что меняется в UX

Страница `/app/matrix` получает новый верхний блок:

1. **Метаданные совещания** — тема, дата, модератор (как сейчас).
2. **Загрузка материалов** — drag-and-drop зона для файлов:
   - Повестка (PDF/DOCX/TXT/MD)
   - Презентация (PPTX/PDF)
   - Сопроводительные материалы (любые документы)
   - Опционально: текст в свободной форме (описание встречи, цель, участники)
3. **Кнопка «Проанализировать материалы»** — запускает AI-анализ.
4. **Прогресс-бар** во время анализа (5–15 сек).
5. После ответа AI таблица из 10 этапов заполняется автоматически:
   - **Статус** — проставлен AI (можно переопределить вручную)
   - **Комментарий** — короткое обоснование от AI («в повестке нет тайминга», «цель сформулирована в разделе X»)
   - **Ответственный / Срок** — пустые, заполняются вручную (AI не может их вывести из документов надёжно)
6. Индикация: рядом со статусом помечается, кто его поставил — AI или человек (badge `AI` / `manual`).

## Архитектура

```text
[Browser]                          [Server]                       [Lovable AI Gateway]
─────────                          ────────                       ───────────────────
Upload files →  Supabase Storage
                (user_id/matrix/{prepId}/...)
                                          
Click "Analyze" → analyzeMatrix()    →  parseDocuments() (текст из PDF/DOCX/PPTX)
   serverFn                              ↓
                                         buildPrompt(10 этапов + критерии + текст)
                                         ↓
                                         generateText() с Output.object schema  →  google/gemini-3-flash-preview
                                         ↓
                                         возвращает {stages: [{key, status_index, confidence, rationale}]}
                                  ←  JSON со статусами + обоснованиями
Заполняет форму, badge="AI"
```

## Технические детали

### 1. Парсинг документов на сервере

Новый файл `src/lib/document-parser.server.ts`:
- PDF → `pdf-parse` (pure JS, работает в Worker)
- DOCX → `mammoth` (extract raw text)
- PPTX → `pptx-text-parser` или собственная распаковка zip + xml (pptx — это zip с XML)
- TXT/MD — `await file.text()`
- Возвращает `{ filename, kind, text }[]`

Файлы скачиваются из Storage через `supabaseAdmin.storage.from('media').download(path)` внутри серверной функции.

### 2. Новая server function

`src/lib/matrix-ai.functions.ts`:

```ts
export const analyzeMatrix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    preparation_id: z.string().uuid(),
    storage_paths: z.array(z.string()).max(10),
    free_text: z.string().max(20000).optional(),
  }).parse)
  .handler(async ({ data, context }) => {
    // 1. Скачать и распарсить все файлы
    // 2. Собрать промпт: системный (правила оценки) + контекст (тексты)
    // 3. Один вызов generateText с Output.object схемой на 10 этапов
    // 4. Записать ai_analysis в meeting_preparations.checks (jsonb)
    // 5. Вернуть результат фронту
  });
```

### 3. AI промпт (один на все 10 этапов)

Системный промпт описывает критерии для каждого этапа в виде JSON-словаря: `{ "goal": { statuses: ["Не определена", ...], criteria: "..." }, ... }`. Берётся из расширенного `MATRIX_STAGES` (добавим поле `criteria: string` к каждому этапу).

Модель: `google/gemini-3-flash-preview` (дёшево, быстро, поддерживает структурированный вывод).

Схема ответа (Zod, передаётся через `Output.object`):
```ts
z.object({
  stages: z.array(z.object({
    key: z.enum(["goal","necessity","participants",...]),
    status_index: z.number().int().min(0).max(3),
    confidence: z.number().min(0).max(1),
    rationale: z.string().max(300),
  })).length(10)
})
```

### 4. Расширение `MATRIX_STAGES`

В `src/lib/matrix-config.ts` к каждому этапу добавим `criteria: string` — что AI должен искать в материалах, чтобы поставить тот или иной статус. Пример для "goal":
> «Цель не определена» — в материалах нет явной формулировки цели. «Черновик» — упомянута, но размыто. «Уточнена» — есть SMART-формулировка. «Утверждена» — указано, что цель согласована с заказчиком/руководителем.

### 5. Схема БД

Не требует миграции — переиспользуем существующее поле `meeting_preparations.checks` (jsonb) для хранения сырых ответов AI (rationale, confidence) и `stages` для итоговой матрицы. Добавляем в каждый stage поле `source: "ai" | "manual"` (хранится в JSONB, типизация на фронте).

### 6. UI компоненты

- `src/components/MatrixDocUploader.tsx` — загрузка в Storage, прогресс, список загруженных.
- Обновить `src/routes/_authenticated/app/matrix.$id.tsx`: добавить блок загрузки, кнопку «Проанализировать», бейджи AI/manual, отображение `rationale` в подсказке (tooltip) рядом со статусом.
- Кнопка «Сбросить к AI» и «Пересчитать» для отдельных этапов.

### 7. Безопасность и лимиты

- Файлы — в приватный бакет `media`, путь `${user.id}/matrix/${preparation_id}/...` (как уже сделано в Stage 3).
- Лимит: 10 файлов, ≤ 5 МБ каждый, суммарно ≤ 20 МБ текста после извлечения (обрезаем).
- Все вызовы AI — на сервере через `LOVABLE_API_KEY`.
- Обработка ошибок Lovable AI: 429 → toast «попробуйте ещё раз», 402 → «закончились кредиты, пополните в Cloud».

## Поэтапная реализация

1. Расширить `MATRIX_STAGES` критериями.
2. Добавить `document-parser.server.ts` + установить `pdf-parse`, `mammoth`.
3. Добавить `matrix-ai.functions.ts` с `analyzeMatrix` server function.
4. Добавить `MatrixDocUploader` и интегрировать в `matrix.$id.tsx`.
5. Обновить тип `MatrixStage` (`source: "ai" | "manual"`, `rationale?: string`, `confidence?: number`) и логику сводки.
6. Проверить на реальной повестке: что AI правильно понимает критерии и не «галлюцинирует» статус «Утверждено» там, где его нет.

## Что НЕ меняется

- Формула расчёта `readiness_percent` и вердикта.
- Список этапов и весов.
- Возможность ручного редактирования (остаётся как fallback).
- Чек-лист (Стадия 1) и анализ записи (Стадия 3).
