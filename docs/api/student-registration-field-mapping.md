# Student registration — field mapping and open decisions

Source of truth: `src/modules/students/student.constants.ts` (`IMPORT_COLUMNS`) and
`src/modules/students/import/row-validator.ts` (`validateRow`). Target table: `students`
(`src/modules/students/register/student.entity.ts`).

## Existing import (summary)

- File: `.xlsx` or `.csv` (`file-parser.ts`), plus an optional documents ZIP (one folder per `source_record_id`).
- Every row is validated and normalised by `validateRow`, then rows are matched for duplicates (Tier 0: source ID;
  Tier 1: Aadhaar blind index; Tier 2: name + DOB + contact; Tier 3: contact only, flagged). A second person finalises
  the batch, and only then are rows written to `students`.
- `students` is the **approved-student register**: `externalStatus` must be `APPROVED`, and `approvedAt` and
  `importBatchId` are NOT NULL. `status` defaults to `RECEIVED`; no other lifecycle status exists yet.

## Field mapping

| Import column | DB column (`students`) | API field | Validation (from `validateRow`) | Use in public registration |
|---|---|---|---|---|
| source_record_id | sourceRecordId | — | required, ≤ 64 | Not accepted from the public; see D3 |
| first_name | firstName | first_name | required, ≤ 100, letters/space/`.'-` | Yes |
| last_name | lastName | last_name | required, ≤ 100, letters/space/`.'-` | Yes |
| father_name | fatherName | father_name | required, ≤ 150 | Yes |
| mother_name | motherName | mother_name | required, ≤ 150 | Yes |
| email | email | email | required, ≤ 254, email format, lower-cased | Yes |
| date_of_birth | dateOfBirth | date_of_birth | required, YYYY-MM-DD, real past date | Yes |
| current_address | currentAddress | current_address | required, ≤ 500 | Yes |
| aadhaar_number | aadhaarEnc / aadhaarBidx / aadhaarLast4 | aadhaar_number | required, 12 digits, not starting 0/1, Verhoeff; stored AES-256-GCM + HMAC index + last 4 | Yes (never returned) |
| mobile_number | mobile | mobile_number | required, Indian 10-digit starting 6–9, stored `+91…` | Yes |
| religion | religion | religion | required, in `RELIGIONS` (NFC) | Yes |
| caste | caste + casteId | caste_id (uuid) | required; import: code or name of an active Caste master record (NFC, case-insensitive) | Yes, by id |
| course_centre | centreCode + regionId | region_id (uuid) | required; import: code or name of an active Region master record | Yes, by id |
| technology | trackCode / trackSourceValue | technology | required, approved track code/name/alias | Yes |
| education_qualification | educationQualification + educationId | education_id (uuid) | required; import: code or name of an active Education master record | Yes, by id |
| approval_status | externalStatus | — | must be `APPROVED` | **Never** from the public |
| approved_at | approvedAt | — | ISO date-time, not future | **Never** from the public |
| evidence_ref | evidenceRef | — | optional, ≤ 120 | No (admin evidence) |
| declaration_accepted | declarationAccepted | declaration_accepted | optional Yes/No | Yes (proposed: must be true) |
| doc_* (13 docs), doc_*_barcode | documents (jsonb), keyed by document type code, each with documentTypeId | documents: [{ document_type_id }] | import: checked only for active Document type master records; required = the type's isMandatory | Declared by id; no file upload |

## Masters (region, caste, education, document type)

Since migration `1792700000000-Masters`, region, caste, education and document type come from the master tables
(`regions`, `castes`, `educations`, `document_types`; see `docs/api/masters-field-mapping.md`).

- **Registration API** takes `region_id`, `caste_id`, `education_id` and an optional `documents: [{ document_type_id }]`
  instead of the free-text `course_centre`, `caste` and `education_qualification`. Each id must belong to an active,
  non-deleted master record; otherwise the response is 422 with the field (`body.region_id`,
  `body.documents.1.document_type_id`, …), together with any other field errors.
- **Stored values:** `students.regionId / casteId / educationId` (nullable FKs, ON DELETE RESTRICT) plus the master's
  text as before: `centreCode` = region code, `caste` = caste name, `educationQualification` = education name. The text
  columns stay so older records still display.
- **Documents:** the declared types are stored in `students.documents` (jsonb), keyed by the type's code, as
  `{ supplied: false, barcode: null, documentTypeId }`. This fits the existing schema (the import writes the same
  shape) and needs no new table; `student_documents` stays for stored files, linked to the type by `docType` = code.
  File upload remains out of scope for the public API.
- **Import:** the masters are loaded once per batch and passed to `validateRow`. The Excel value matches by code or name,
  case-insensitively; an unknown or inactive value raises `REF_UNKNOWN` (waivable), as before. Finalisation writes the
  FK ids. Document columns stay `doc_<code>` (the 13 existing types); a type that is inactive in the master is
  not checked, and `required` follows its `isMandatory` flag.
- **Education:** no list was supplied, so the master starts empty. Until records are added, every import row raises
  `REF_UNKNOWN` on `education_qualification` (waivable), and registrations cannot be submitted.

## Decisions needed before implementation

- **D1 — Where a registration is stored.** `students` holds approved students only (approval columns and
  `importBatchId` are NOT NULL). Options:
  - (a) A new `student_registrations` table with the same columns, minus the approval ones, plus `status`.
    An approved registration is later promoted into `students` through the existing review path.
  - (b) Relax `students` columns to nullable and add a pending status.

  Both need a migration.
- **D2 — Initial status.** No pending status exists (`students.status` only has `RECEIVED`). Proposed:
  `REGISTRATION_PENDING`, then `UNDER_REVIEW`, then `APPROVED` or `REJECTED`.
- **D3 — Registration reference.** The import relies on the external `source_record_id`. Proposed: the server
  generates `REG-YYYY-NNNNNN` and returns it.
- **D4 — Duplicate rules.** Proposed: reject with 409 when the Aadhaar blind index matches an existing registration
  or student (enforced by a unique partial index), and flag a name + DOB + mobile match for review instead of
  rejecting.
- **D5 — Documents.** Should the public form upload files (which limits, which are required), or are documents
  collected later?
- **D6 — Public website.** This workspace has no public website or registration form. `D:\kalash\index.html` is
  the portal launcher, and the specification says students register on the external MahaAmrut form. Which site
  should call this API, and does it replace the MahaAmrut redirect?
- **D7 — CORS.** The approved website origin(s) to allow.
