# Deployment (backend)

## Environments

| Environment | Database | Secrets | Notes |
|---|---|---|---|
| development | local `*_db` | `.env` (git-ignored) | `npm run dev` |
| test | local `*_test` | `.env.test` (git-ignored) | rebuilt by the test run |
| staging | dedicated database + user | secret manager | production-like; `API_DOCS_ENABLED=true` is fine |
| production | dedicated database + user, `DB_SSL=true` | secret manager | docs off by default |

Each environment has its own `JWT_SECRET`, `STUDENT_DATA_KEY`, `STUDENT_INDEX_KEY` and database credentials. **Never rotate `STUDENT_DATA_KEY` without re-encrypting stored Aadhaar values; never change `STUDENT_INDEX_KEY` without recomputing blind indexes.**

## Release steps

```bash
npm ci
npm run lint && npm run typecheck && npm test   # CI
npm run build
npm run migration:run:prod     # back up first; migrations never drop data
npm run seed:prod              # idempotent; no demo content (docs/database/README.md, Seeds)
npm run admin:create:prod -- --email … --name …   # first install only
npm start                      # behind HTTPS
```

- The server refuses to start while migrations are pending.
- Load balancer: liveness `GET /api/v1/health/live`, readiness `GET /api/v1/health/ready` (503 when the database is down or migrations are pending).
- Graceful shutdown on SIGTERM (finishes in-flight requests, 10 s limit).
- Cookies: serve the API over HTTPS on the same registrable domain as the admin panel (see [ADR-0003](adr/0003-browser-sessions.md)); set `FRONTEND_URL` to the panel origin.
- Several instances can run behind a load balancer. Per-instance: permission cache (bounded by `PERMISSION_CACHE_TTL_MS`) and rate limits (use a shared store if strict global limits are required).

## Rollback

`npm run migration:revert` reverts the most recent migration (review its `down()` first), then deploy the previous build. Prefer forward fixes for data migrations.
