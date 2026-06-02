# План: личный кабинет + новая логика стадий + журнал

## 1. Авторизация (email/пароль без подтверждения)

- Включить `auto_confirm_email = true` через `configure_auth`.
- Страница `/auth` — единый экран Вход / Регистрация (email + пароль), без OAuth.
- Защищённая ветка `src/routes/_authenticated/route.tsx` (`ssr:false`, `beforeLoad` → `supabase.auth.getUser()` → редирект на `/auth`).
- `onAuthStateChange` в `__root.tsx` для инвалидации кэша.
- Кнопка «Выйти» в сайдбаре.

## 2. Привязка данных к пользователю (приватность)

Миграция:
- Добавить `user_id uuid` (NOT NULL после backfill) в `analyses` и `meeting_preparations` (+ новая таблица `meeting_checklists`).
- Удалить публичные RLS-политики `public read/insert/update/...`.
- Новые политики: `auth.uid() = user_id` для SELECT / INSERT / UPDATE / DELETE.
- GRANT-ы только для `authenticated` и `service_role` (не `anon`).
- Индексы на `user_id` + `created_at`.

Серверные функции (`createServerFn` + `requireSupabaseAuth`) фильтруют по `userId` автоматически через RLS.

## 3. Левая боковая панель

Новый компонент `AppSidebar` (shadcn `Sidebar`, `collapsible="icon"`) заменяет `TopNav`. Пункты:

- `1 · Чек-лист подготовки` → `/app/checklist`
- `2 · Журнал + матрица` → `/app/matrix`
- `3 · Запись и анализ` → `/app/meeting`
- `Все совещания` → `/app/journal`
- внизу: email пользователя + Выйти

Все маршруты под `/_authenticated/app/...`.

## 4. Новая логика трёх стадий

### Стадия 1 — Чек-лист «Успешное совещание» (16 правил)

Новая таблица `meeting_checklists`:
- `topic, meeting_date, moderator`
- `items jsonb` — массив 25 факт-чеков с полями `{ rule_no, rule_title, fact, weight, done }` (предзаполнен по xlsx)
- `score numeric` — Σ(weight × done) / Σweight × 100
- `notes` (отвлечения от повестки, экономия времени)

UI `/app/checklist` — список + создать. `/app/checklist/$id` — таблица 25 строк с чекбоксами «Выполнено», справа автосумма % и распределение по правилам. Кнопка «Сохранить итог».

### Стадия 2 — Журнал + матрица статусов (10 этапов подготовки)

Расширяем существующую `meeting_preparations`:
- Добавить `stages jsonb` — 10 этапов из матрицы со схемой `{ key, title, status, status_index, responsible, due_date, comment, weight }`.
- Добавить `readiness_percent`, `blocking_count`, `verdict_label` (computed at save).

UI `/app/matrix` — список подготовок. `/app/matrix/$id` — форма по шаблону xlsx (название, дата, модератор) + таблица 10 этапов с `Select` статуса (варианты из матрицы), полями «Ответственный / Срок / Комментарий», справа вес и оценка. Внизу итог: % готовности, кол-во блокирующих, вердикт («НУЖНА ДОРАБОТКА» / «ГОТОВО»). Кнопка AI-перепроверки остаётся.

Матрица статусов хранится константой в `src/lib/matrix-config.ts`.

### Стадия 3 — Запись + анализ + PDF (как сейчас)

`/app/meeting` — текущий поток без изменений в логике (Fireflies → транскрипт → AI). Добавления:
- Кнопка **«Скачать PDF»** в `/app/meeting/$id` — серверная функция `generateReportPdf` (использует `pdf-lib`/`@react-pdf/renderer`) собирает summary, оценку, action items, language → возвращает base64, скачивается клиентом.
- Блок рассылки остаётся под кнопкой PDF (не отдельная стадия).

## 5. Вкладка «Все совещания» (`/app/journal`)

Объединённый список из трёх источников (server fn `loadJournal`):
- из `meeting_checklists` — оценка по чек-листу
- из `meeting_preparations` — % готовности, вердикт
- из `analyses` — оценка LLM, язык, статус

Колонки таблицы: Дата · Тема · Модератор · % готовности · Оценка чек-листа · Оценка анализа · Статус · Язык · → детали.

Фильтры (клиентские): по дате (range), статусу, языку, минимальной оценке.

Кнопка **«Экспорт в Excel»** — серверная функция строит .xlsx через `exceljs` и отдаёт файл.

## 6. Технические правки

- `__root.tsx` — `SidebarProvider`-обёртка только под `_authenticated`; публичные `/`, `/auth` — без сайдбара.
- `src/routes/index.tsx` — лендинг (как сейчас), кнопка «Войти» вместо «Начать».
- Удалить `TopNav` со страниц приложения.
- Footer оставить.
- Все существующие сервер-функции получают `requireSupabaseAuth` и фильтр по `user_id`.

## 7. Порядок реализации

1. Миграция: auth + user_id + RLS + новая таблица `meeting_checklists`.
2. `_authenticated` layout, `/auth`, AppSidebar.
3. Стадия 1 (чек-лист) — таблица, route, server fns, UI.
4. Стадия 2 — расширение matrix, переписать форму.
5. Стадия 3 — PDF download.
6. `/app/journal` + Excel export.
7. Чистка старых публичных политик и `TopNav`.
