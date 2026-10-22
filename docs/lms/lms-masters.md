# LMS Admin — core masters

The eight core masters of the LMS Admin (AMRUT_KALASH_03 LMS Admin Functional & Technical Specification), built in this
backend (`src/lms/*`) and the admin frontend (`amrut-kalash-admin/src/features/lms/*`).

| # | Master | Spec | Backend | API base (`/api/v1/lms`) | Frontend folder |
|---|---|---|---|---|---|
| 1 | Entity Master | L-03, F-LMS-03, DB-302 | `src/lms/entity` | `/entities` | `entity` |
| 2 | Academic Calendar + learning configuration | L-05, F-LMS-05, DB-304 | `src/lms/calendar` | `/calendars` | `calendar` |
| 3 | Form Field Configuration | L-38, F-LMS-FFC, DB-305 | `src/lms/form-field` | `/form-fields` | `formField` |
| 4 | Branding and Settings | L-04, F-LMS-04 | `src/lms/branding` | `/branding` | `branding` |
| 5 | Reference Data (read-only) | AD-09, DB-303, UI-314 | `src/lms/reference` | `/reference` | `reference` |
| 6 | Course Master | L-06, F-LMS-06, DB-310 | `src/lms/course` | `/courses` | `course` |
| 7 | Module Master (four programme modules) | L-06, F-LMS-07, §2.1 | `src/lms/course-module` | `/course-modules` | `courseModule` |
| 8 | Technology Track / Track Variant | L-07, F-LMS-29, F-LMS-32, UI-317 | `src/lms/track-variant` | `/track-variants` | `trackVariant` |

## Architecture decision (deviation from the spec)

The spec proposes two backends and two databases (AD-01: `amk_admin` and `amk_lms`) with reference data copied to
the LMS (AD-09, INT-005). This project has one backend and one database, so the LMS masters live in a separate
`src/lms` area with `lms_*` tables and `lms-*` permission codes. The Admin Panel owns districts, training centres
and technology tracks (`districts`, `training_centres`, `technology_tracks`). The LMS reads them live and never
writes them, so there is no copy, sync job or "synchronise now" action. Splitting the LMS out later means
replacing the reference reads with the INT-005 client. Module boundaries are enforced by
`scripts/check-boundaries.mjs`.

## Data model (migrations)

| Migration | Tables |
|---|---|
| `1792500000000-TechnologyTracks` | `technology_tracks` (Admin Panel; T01–T12 seeded from the spec) |
| `1792600000000-LmsEntities` | `lms_entities`, `lms_entity_centres`, `lms_entity_tracks` |
| `1792700000000-LmsBranding` | `lms_entity_settings` (one row per entity and key, typed `jsonb` value) |
| `1792710000000-LmsAcademicCalendars` | `lms_academic_calendars`, `lms_calendar_holidays`, `lms_learning_config` |
| `1792720000000-LmsFormFields` | `lms_form_fields` (seeds the 26 standard Trainer Profile fields of F-LMS-TRN) |
| `1792730000000-LmsCourses` | `lms_courses` |
| `1792740000000-LmsCourseModules` | `lms_course_modules` |
| `1792750000000-LmsTrackVariants` | `lms_track_variants` + `_phases`, `_modules`, `_components`, `_oft_cards`, `_assessment_components`, `_readiness_gates` |

All tables share the same conventions:
- **Base columns:** `id`, `createdAt`, `updatedAt` (trigger), `isActive`, `isDelete`.
- **Uniqueness:** partial unique indexes over non-deleted rows.
- **Integrity:** CHECK constraints repeat the validators' rules, and foreign keys use `ON DELETE RESTRICT`.
- **Delete:** soft delete plus restore.

Who did what and when is recorded in the audit log, not in `createdBy`/`updatedBy` columns.

**Cross-master guards:**
- **Entity archive:** refused while courses or calendars reference the entity (`ENTITY_REFERENCES`).
- **Entity code:** frozen once a course uses the entity.
- **Centre removal:** a centre can't be removed from an entity while that entity's calendars use it (`CENTRE_REFERENCES`).
- **Course delete:** refused while the course has modules.
- **Module delete:** refused while a track variant uses the module.
- **Default language:** changing an entity's default language enables that language in Branding.

## API

- **Envelope:**
  - success: `{ success: true, message, data, meta? }`, where `meta` is the pagination block;
  - error: `{ success: false, message, error: { code, requestId, details: [{ field, message }] } }`.
- **Status codes:**
  - 400 business rule;
  - 401 no session;
  - 403 permission;
  - 404 not found;
  - 409 duplicate, conflict or guard;
  - 422 validation.
- **Lists:** take `page`, `limit` (≤ 100), `search`, `sortBy` (whitelist), `sortOrder`, `isActive` and the filters each master lists.
  - `deleted=true` returns only soft-deleted rows, with the same search, filters, sort and paging, so they can be restored. It works on entities, calendars, form fields, courses, course modules and track variants.
  - The screens show it as a "Show deleted" switch, visible only to users with the master's `.delete` permission.
- **Writes:** need a session (cookie) and the permission shown; every write is audited.
- **Interactive docs:** Swagger UI at `/api/docs` (OpenAPI generated from the zod schemas).

**Common endpoint pattern.** Entities, calendars, form fields, courses, course modules and track variants each have:

| Method and path | Permission |
|---|---|
| `GET /` (list) | `.view` |
| `GET /:id` | `.view` |
| `POST /` | `.create` |
| `PUT` or `PATCH /:id` | `.update` |
| `PATCH /:id/status` with `{ isActive }` | `.update` |
| `DELETE /:id` (soft delete) | `.delete` |
| `POST /:id/restore` | `.delete` |

Permission codes are `lms-<menu>.view|create|update|delete`, for example `lms-courses.create`.

**Endpoints specific to each master:**

| Master | Endpoint | Permission |
|---|---|---|
| Reference | `GET /reference/summary`, `/districts`, `/centres`, `/tracks` | `lms-reference.view` |
| Reference | `GET /reference/options/centres?entityId=`, `/options/tracks?entityId=`. With `entityId`, returns only what that entity enabled. | view permission of any master that picks a centre or track |
| Reference | No POST, PUT, PATCH or DELETE exists; they answer 404 (read-only, BRL-309). | — |
| Entity | `GET /entities/options`, `GET /entities/form-options` | any LMS view |
| Branding | `GET /branding/:entityId`, `PUT` or `PATCH /branding/:entityId` (only changed keys) | `lms-branding.view` / `.update` for display name, logo and colours, `.update-settings` for support contacts and languages (L-04: `entity.branding.update` / `entity.update`); a key the caller's code does not cover is refused (403) |
| Branding | `GET`, `PUT` (multipart `file`, PNG) or `DELETE /branding/:entityId/logo`. Optional size limits come from `LMS_LOGO_MAX_WIDTH_PX` / `LMS_LOGO_MAX_HEIGHT_PX` (unset = no limit); the branding GET returns them as `logoRules`. | `lms-branding.view` / `.update` |
| Calendar | `GET /calendars/options?entityId=`, `GET /calendars/form-options` | calendar view |
| Calendar | `GET /calendars/learning-config?entityId=`, `PUT` or `PATCH /calendars/learning-config/:key` (reason required) | `lms-learning-config.view` / `.update` (L-05 `config.learning.*`; its own menu) |
| Form fields | `GET /form-fields/form-options`, `GET /form-fields/forms/:formCode/effective`, `GET /form-fields/forms/:formCode/sections` (standard sections plus every custom section, with field counts) | form-field view |
| Course | `GET /courses/options?entityId=`, `GET /courses/languages?entityId=` | course view |
| Course | `POST /courses/:id/retire` | `lms-courses.delete` |
| Module | `GET /course-modules/options?courseId=&moduleNumber=`, `GET /course-modules/prescribed` | module view |
| Module | `POST /course-modules/prescribed` with `{ courseId, syllabusRef }` (creates the missing modules 1–4 from the syllabus defaults) | module create |
| Track variant | `GET /track-variants/form-options`, `POST /track-variants/:id/publish` (refused while incomplete) | track-variant view / update |
| Track variant | `POST /track-variants/:id/retire` | track-variant delete |
| Track variant | `/:id/{phases, track-modules, learning-components, oft-cards, assessment-components, readiness-gates}`: `GET`, `GET /:itemId`, `POST`, `PUT` or `PATCH /:itemId`, `DELETE /:itemId`, `POST /oft-cards/:itemId/retire` | track-variant view / create / update / delete |

### Sample: create a course

```http
POST /api/v1/lms/courses
Content-Type: application/json
Cookie: amrut_session=…

{ "entityId": "6f0c…", "code": "AMK-COURSE", "title": "AMRUT KALASH Digital Skills Programme",
  "description": "<p>Four modules and one <strong>technology track</strong>.</p>", "languages": ["en"] }
```

Response `201` (abridged: `entity`, `publishedReleaseNo`, `createdAt` and `updatedAt` are also returned):

```json
{ "success": true, "message": "Course created successfully",
  "data": { "id": "9b1e…", "entityId": "6f0c…", "code": "AMK-COURSE", "title": "AMRUT KALASH Digital Skills Programme",
            "status": "DRAFT", "publishedReleaseId": null, "languages": ["en"], "isActive": true,
            "modules": [], "missingModuleNumbers": [1, 2, 3, 4], "hasAllModules": false, "references": [] } }
```

A duplicate code returns 409:

```json
{ "success": false, "message": "A course with this code already exists",
  "error": { "code": "CONFLICT", "requestId": "…", "details": [{ "field": "code", "message": "This course code is already used." }] } }
```

### Sample: create the four prescribed modules

```http
POST /api/v1/lms/course-modules/prescribed
{ "courseId": "9b1e…", "syllabusRef": "<title and version of the approved syllabus document>" }
```

This creates whichever of modules 1–4 the course is missing, from the confirmed syllabus values in spec §2.1:
- core hours 60 / 60 / 300 / 80;
- sessions;
- OFT hours 42–48 / 42–48 / 210–240 / 56–64.

All modules are created in one transaction.

## Run locally

```bash
npm install
npm run migration:run      # creates the LMS tables (needs .env pointing at the database)
npm run seed               # idempotent: adds the lms-* permissions; SUPER_ADMIN receives all of them
npm run dev                # API on PORT (5001)
```

Frontend: `npm run dev` in `amrut-kalash-admin`. The screens are under **LMS Admin** in the sidebar.

Order of use:
1. Create an entity, enabling its centres and tracks.
2. Optionally set up its branding and calendars.
3. Create a course.
4. Create the prescribed modules.
5. Create one track variant per enabled track on Module 3.
6. Fill in each variant's curriculum and publish it.

## Tests

- **Backend** (`tests/integration/lms/*.test.ts`, one suite per master):
  - Covers CRUD, validation, duplicates, permissions, reference guards and read-only rules.
  - Run `npm test` (unit tests plus db tests against `.env.test`; the database name must contain `test`).
- **Frontend** (`src/features/lms/*/tests`, vitest + Testing Library):
  - Covers lists, forms, validation, permission gating, server errors and confirmations.
  - Run `npm test`.

## Open specification questions and dependencies

These are kept configurable or left empty rather than invented:

- **OQ-009:** the entity model and the single "AMRUT KALASH" entity. Nothing is seeded; create the entity on screen.
- **OQ-012:** the syllabus values are pending approval. The values used are the confirmed figures from §2.1. Syllabus reference text and module descriptions are not in the spec; you enter them.
- **OQ-013:** assessment methodology, weights, gate minimum band, pass marks and progression. All empty and marked "To Be Confirmed".
- **OQ-014 / OQ-015:** attendance and certification rules. Learning-configuration keys with no value, marked "To Be Confirmed".
- **OQ-023:** platform languages. English and Marathi are configured as proposed, but the list is still open.
- **OQ-042:** five learning-configuration keys keep separate Offline and Online values.
- **Content releases (L-30):** not built.
  - Course `PUBLISHED` and release fields stay empty.
  - Track-variant publish stands in for "included in a release".
  - OFT card codes freeze on variant publish, not on release to a batch.
- **LMS batches, sessions, lessons and the Trainer Profile:** not built. As a result:
  - "retire blocked while active batches" isn't enforced;
  - calendar checks against sessions aren't done;
  - stored-value counts for form fields are always 0 (`FORM_FIELD_VALUE_SOURCES` is empty).
- **Branding:**
  - the spec gives no logo dimension values: they are configuration (`LMS_LOGO_MAX_WIDTH_PX` / `LMS_LOGO_MAX_HEIGHT_PX`), unset by default;
  - there is no malware scanner;
  - SVG logos are not accepted, because there is no sanitiser.
- **KPI totals** on the list screens count non-deleted records only.
