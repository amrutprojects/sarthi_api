# G-2 input: Amrut's `lms_*` tables and screens → their `/tenant/v1` replacement

> **Decided 21 Nov 2026 (user):** the `lms_*` tables are **kept permanently** and are never dropped, renamed or
> emptied. A Panel setting ("Show live LMS data", [../mt-g2-live-data-setting.md](../mt-g2-live-data-setting.md))
> chooses whether the screens show local or live data. The retirement options below are superseded; the mapping stays
> as reference for which live read feeds which screen.

For the later G-2 decision (retire Amrut's LMS copies). **Nothing here is done by M1**: the tables, the
`/api/v1/lms/*` routes and their screens stay unchanged. Sources: this repo's migrations and `docs/lms/lms-masters.md`;
lms-api `main` 22d77784 (`/tenant/v1` §2, §2b) and branch `claude/mt-tenant-integration-ops-*` dbd9ec26 (§6,
API-100…112, not merged).

## The main finding

Amrut's `lms_*` tables are **not copies of LMS delivery data**. They are the **LMS Admin masters** (configuration)
that were built in this repo when the LMS was planned as part of this backend (see `docs/lms/lms-masters.md`,
"Architecture decision"). The data the M1 item names (summary, centres, batches, sessions, trainers, attendance) has
**no Amrut table at all**: the Panel's Delivery / Training / Dashboard screens run on mock services. The new
`/api/v1/lms-reads` routes give them a real source without any new table.

So G-2 is really two questions:
1. **Delivery reads** (no table to retire): switch the Panel screens from mocks to `/api/v1/lms-reads/*`. Ready now
   behind `LMS_READS_ENABLED`.
2. **The LMS Admin masters** (`lms_*`): who authors entities, calendars, form fields, branding, courses, modules and
   track variants: Amrut's copy here or the LMS's own admin UI. `/tenant/v1` is a read and intake channel; it has
   **no write** for any of these masters, and **read-back** for only some (via API-100 `/catalogue`).

## Table / screen mapping

| Amrut table(s) | Amrut screen / route (`/api/v1/lms/…`) | `/tenant/v1` replacement | Gap |
| --- | --- | --- | --- |
| `lms_entities`, `lms_entity_centres`, `lms_entity_tracks` | Entity Master `/entities` | Read: API-100 `GET /catalogue` (entities, scope `catalogue.read`); `/summary` lists the tenant's entities; `/centres` gives the centres the entities use | No write. Entity–track links not in `/catalogue` shape (open object). Entities are created by the LMS Super Admin per tenant. |
| `lms_entity_settings` | Branding & Settings `/branding` | None | No read or write of branding / support contacts / languages. |
| `lms_academic_calendars`, `lms_calendar_holidays` | Academic Calendar `/calendars` | None | No read. Session dates come through `/sessions`, `/live-sessions`. |
| `lms_learning_config` | Learning Configuration `/calendars/…` (learning config) | None | No read. |
| `lms_form_fields` | Form Field Configuration `/form-fields` | None directly; the intake field list is the `StudentRecord` schema of `POST /students` (fixed by the LMS) | Field configuration is LMS-owned; no read. |
| `lms_courses` | Course Master `/courses` | Read: API-100 `GET /catalogue` (courses); `course_code` on `/batches` | No write. |
| `lms_course_modules` | Module Master `/course-modules` | Partly: `module_no` on `/sessions`; API-111 `/operations-summary` per-module progress | No module catalogue read. |
| `lms_track_variants` + `_phases`, `_modules`, `_components`, `_oft_cards`, `_assessment_components`, `_readiness_gates` | Track Variant Master `/track-variants` | Partly: `track_code` on `/batches`, `/summary.by_track` | No read of variant structure. |
| `role_lms_permissions` | LMS roles `/lms-access/*` | Not a copy: Amrut's own record of which LMS menus a Panel role opens (Panel users signing in to the LMS) | Out of scope for G-2 retirement. |
| — (Admin Panel's own `districts`, `training_centres`, `technology_tracks`) | Reference Data `/reference` (read-only) | The opposite direction: the LMS pulls these from Amrut (`/integration/v1/reference`, API-122) | Not an LMS copy; keep. |
| — (no table; mock) | Dashboard KPIs, Executive, Today | `/summary` → `/api/v1/lms-reads/summary` | `?group_by=district\|centre\|month` (§2b) not built on the LMS yet. |
| — (mock) | Batches, Batch detail | `/batches` → `/api/v1/lms-reads/batches` | `GET /batches/{batch_code}` (§2b) not built yet; filter the list meanwhile. |
| — (mock) | Trainers, Trainer detail, ToT | `/trainers` → `/api/v1/lms-reads/trainers` | `/trainers/{code}`, `/tot` (§2b) not built yet. |
| — (mock) | Live / Online / Offline sessions | `/sessions`, API-110 `/live-sessions` → `/api/v1/lms-reads/sessions`, `/live-sessions` | `?mode=&state=` on `/sessions` (§2b) not built; API-110 not merged on lms-api. |
| — (mock) | Attendance | `/attendance` → `/api/v1/lms-reads/attendance` | `?group_by=day` (trend) not built yet. |
| — (mock) | Training Centres (delivery view) | `/centres` → `/api/v1/lms-reads/centres` | — |
| — (mock) | Progress, Lifecycle / At-risk, Assessments, Certification | §2b `/progress`, `/learners`, `/assessments/results`, `/certificates`; or §6 API-106/107/111 | Not read by this branch (not in the M1 item); a later step. |

## What G-2 would need to decide

1. Screens: switch Dashboard / Delivery / Training screens to `/api/v1/lms-reads/*` (flag in the admin app), then drop
   their mocks. No data migration.
2. Masters: either keep authoring in Amrut (then they must be **pushed** to the LMS: no `/tenant/v1` write exists;
   would need new LMS operations) or move authoring to the LMS admin UI and retire the `lms_*` tables + `src/lms/*`
   routes and screens (needs an export of current rows for the LMS team first). The LMS already owns entities,
   courses and batches per tenant, so the second option avoids two sources of truth.
3. Read-back for retired masters: only entities and courses (API-100 `/catalogue`) can be shown read-only in the
   Panel today; calendars, form fields, branding, modules and track-variant structure would need new tenant reads.
