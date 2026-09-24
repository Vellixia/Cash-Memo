# Cash-Memo

Personal money journal: log income/expense memos per currency, see monthly totals. No currency conversion.

| Path | What |
|---|---|
| `apps/api` | Rust API — Axum + SeaORM, Postgres, migrations run on boot |
| `apps/web` | Next.js (Bun) — proxies `/api/*` to the API, so the browser sees one origin |

## Dev

```sh
cp .env.example .env
docker-compose up -d db
bun install
bun run dev      # api :8080, web :3000
bun run test     # api integration test hits the local db
bun run lint
bun run build
```

## Deploy

Push to `v1` → GitHub Actions builds `ghcr.io/vellixia/cashmemo-{api,web}` → Dokploy project `cashmemo` pulls them.

- api env: `DATABASE_URL`, `COOKIE_SECURE=true`
- web env: `API_URL=http://<api-service>:8080`
