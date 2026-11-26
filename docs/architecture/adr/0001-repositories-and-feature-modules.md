# ADR-0001: Two repositories; feature modules as the primary unit

- Status: Accepted
- Date: 2026-10-19

## Context

The architecture brief describes one `admin-panel/` folder holding `frontend/` and `backend/`. The project already has two GitHub repositories — `sarthi-api` (backend) and `sarthi-admin` (frontend) — each with its own history, and the team asked to keep them separate. The backend was organised by technical layer (`controllers/`, `services/`, `repositories/`…), which scales poorly when several developers work on different features.

## Decision

1. Keep **two repositories**, each independently installable, testable, buildable and deployable. Each has its own README, `docs/`, lint/format/test configuration and `.env.example`. Shared decisions (such as the session design) are recorded in both.
2. Organise each codebase by **feature module** (`src/modules/<feature>/`), with technical responsibilities as files inside the module (`*.routes.ts`, `*.controller.ts`, `*.service.ts`, `*.repository.ts`, `*.validation.ts`, `*.mapper.ts`, `*.entity.ts`, `*.openapi.ts`). Genuinely independent workflows become sub-folders (e.g. `students/import/` and `students/register/`).
3. Only cross-cutting code lives outside modules: `config/`, `database/`, `middleware/`, `shared/`, `observability/`.

## Consequences

- A feature's code is in one place; adding a module does not touch other modules except the composition roots.
- No empty boilerplate modules: a module folder exists only when it has behaviour.
- Contract changes that affect both repositories (e.g. a new endpoint used by the panel) are released backend-first and stay backward-compatible until the frontend has moved.
