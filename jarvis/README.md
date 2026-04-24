# JARVIS — Personal Health OS

A private, self-hosted AI health operating system built on Node.js + SQLite.
Ingests data from Apple Health Export, runs scheduled briefings, and provides
an AI chat agent (Claude) accessible via Telegram and a web dashboard.

## What it does

- **Health data ingestion** — parses Apple Health Export XML, stores all metrics in SQLite
- **AI agent (Claude)** — tool-calling health assistant with full access to your data
- **Telegram bot** — interactive chat, voice message transcription (Whisper), proactive reminders
- **Web dashboard** — vitals, diet, performance, gut health, correlation analysis
- **CRON jobs** — daily morning briefings, weekly reports, watch sync monitoring
- **Correlation engine** — finds patterns across sleep, HRV, glucose, gut, training load

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js + Express |
| Database | SQLite (via better-sqlite3) |
| AI agent | Anthropic Claude (tool-calling) |
| Voice transcription | OpenAI Whisper |
| Notifications | Telegram Bot API |
| Scheduling | node-cron |
| Deployment | Docker + docker-compose |

## Key files

| File | Description |
|---|---|
| `server.js` | Express API — all routes, CRON jobs, health data ingestion |
| `jarvis.js` | AI agent core — Claude tool-calling, Telegram webhook handler |
| `db.js` | All database schema and query functions |
| `correlations.js` | Cross-metric correlation analysis engine |
| `docker-compose.yml` | One-command local or server deployment |
| `public/` | Web dashboard (vitals, diet, performance, gut health) |

## Setup

See `SETUP.md` for full instructions.

Copy `.env.example` to `.env` and fill in your API keys:

```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

Then:

```bash
npm install
npm start
```

Or with Docker:

```bash
docker-compose up -d
```

## Note

This is a personal, self-hosted system — not a multi-tenant product.
All data stays on your own machine or server. No third-party data sharing.
