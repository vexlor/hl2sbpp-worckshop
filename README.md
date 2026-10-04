# HL2SBPP Workshop v5 — Supabase Edition

Server-side HL2SBPP Workshop using **Node.js + Supabase PostgreSQL**.

## Что уже есть

- регистрация и вход;
- bcrypt-хеширование паролей;
- HttpOnly-сессии в PostgreSQL;
- автоматический переход в Workshop после регистрации;
- сохранение входа между посещениями;
- поиск и категории;
- публикация ZIP-аддонов;
- скачивание и счётчик скачиваний;
- Like;
- Subscribe;
- комментарии API;
- `/api/health` для проверки подключения к Supabase;
- текущий дизайн HL2SBPP Workshop.

## Важно: Android Postgres Client не нужен

Supabase предоставляет PostgreSQL в облаке. Android-приложение Postgres Client нужно только для ручного просмотра базы. Сам сайт подключается к Supabase напрямую через `DATABASE_URL`.

## Настройка Supabase

1. Создай проект Supabase.
2. Открой **Connect → Direct → Connection string**.
3. Для этого проекта Host:

```text
db.ilboyrygaxintwrawdzg.supabase.co
```

4. Создай `.env` на сервере на основе `.env.example`.
5. Укажи пароль базы в `DATABASE_URL`.

Пример:

```env
DATABASE_URL=postgresql://postgres:YOUR_DATABASE_PASSWORD@db.ilboyrygaxintwrawdzg.supabase.co:5432/postgres?sslmode=require
NODE_ENV=production
PORT=3000
```

**Никогда не публикуй реальный `DATABASE_URL` и пароль.**

При запуске сервер автоматически создаёт таблицы из `db/schema.sql`.

## Запуск

Требуется Node.js 20+.

```bash
npm install
npm start
```

Проверка:

```text
GET /api/health
```

Должен вернуться JSON с `ok: true` и `database: "supabase-postgres"`.

## Хранилище ZIP

Сейчас ZIP-файлы хранятся на диске сервера в `uploads/`. Для постоянного публичного сервера лучше заменить это на S3-совместимое хранилище или Supabase Storage. Это отдельный следующий шаг.

## Перед публичным запуском

- HTTPS;
- резервные копии;
- проверка ZIP на вредоносное содержимое;
- полноценная CSRF-защита;
- лимиты/модерация загрузок;
- админ-панель;
- постоянное хранилище файлов;
- мониторинг и логирование.
