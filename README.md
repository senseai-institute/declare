# Declare

A card game companion for in-person and virtual play: server-side shuffling and
dealing, player sessions, and score tracking per game, per session/trip, and
long-term per group. Mobile-first — built for phones at the table.

## Stack

- Node 20 + TypeScript, one repo, one service
- Fastify + Socket.IO (live updates), PostgreSQL via Prisma
- React + Vite + Tailwind, served as static files by Fastify in production

## Features

- **Groups** — recurring crews with a 6-character join code, share link and QR.
- **Sessions** — a trip or game night, in a group or ad-hoc. Join by code/QR,
  or add people without a phone as guests (they can later claim their name).
- **Games** — pick players (seat order), game type (presets for Hearts, Spades,
  Rummy, Cribbage…), high/low wins, optional target score that auto-ends the game.
- **Score entry** — one big row per player, +/- toggle, running totals preview,
  live on every device. Tap any past round to fix it; every change goes to an audit log.
- **Leaderboards** — session standings and a group leaderboard (wins, win %,
  average finishing place, sessions won), filterable by game type.
- **Virtual deck** (optional per game) — 1–8 decks, 0–2 jokers per deck,
  Fisher–Yates with `crypto.randomInt`. Deal, draw, take discard, discard,
  reshuffle discard into draw pile, reset. Each client only ever receives its own hand.

## Local development

```bash
cp .env.example .env          # point DATABASE_URL at a local Postgres
npm install
npx prisma migrate dev        # create tables
npm run dev                   # API on :3000, Vite on :5173 (proxies /api and /socket.io)
npm test                      # deck + scoring unit tests
npm run typecheck
```

## Deploying to Railway

1. Create a project from this repo and add the **PostgreSQL** plugin.
2. On the app service, set `DATABASE_URL` to `${{Postgres.DATABASE_URL}}` and
   `NODE_ENV=production`.
3. Deploy. `railway.json` runs `npm run build`, then `npm start`, which applies
   migrations (`prisma migrate deploy`) before starting the server. Health check: `/api/health`.

## Identity

No passwords in v1: each device gets a random token in an httpOnly cookie
(`declare_device`). Players can add an email on their profile for claiming
accounts later.

## API sketch

| Method | Path | |
| --- | --- | --- |
| GET/POST/PATCH | `/api/me` | current player / set name / email |
| GET | `/api/home` | my groups and sessions |
| GET/POST | `/api/join/:code` | preview / join a group or session |
| POST | `/api/groups`, `/api/groups/:id/members` | create group, add guest |
| GET | `/api/groups/:id`, `/api/groups/:id/leaderboard?gameType=` | |
| POST | `/api/sessions`, `/api/sessions/:id/{players,close,reopen,games}` | |
| GET | `/api/sessions/:id` | players, games, standings |
| GET | `/api/games/:id`, `/api/games/:id/audit` | |
| POST | `/api/games/:id/rounds`, `/api/games/:id/end` | |
| PUT | `/api/games/:id/rounds/:roundId` | edit (logged) |
| GET | `/api/games/:id/deck` | your private view |
| POST | `/api/games/:id/deck/{shuffle,deal,draw,draw_discard,discard,reshuffle,reset}` | |

Socket.IO: `subscribe(room)` for `group:ID` / `session:ID` / `game:ID`; the
server emits `changed {room}` and a per-player `deck {gameId, view}`; clients
may send `deck:action {gameId, action}` with an ack.
