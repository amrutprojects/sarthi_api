# Masters: Region, Caste, Document type, Education

**Source.** The document "shared by Prasad" was not found in this workspace, Downloads, Documents or Desktop. The fields
below were confirmed by the user on 2026-10-19:

- every master has code, name, description and an active status;
- document types also have a mandatory flag;
- Region means the course centre;
- the seed covers PAN, Aadhaar and LC plus the lists that were hard-coded in `student.constants.ts`.

## Fields (all four masters)

| Field | DB column | Type | Validation |
|---|---|---|---|
| id | id | uuid | generated |
| code | code | varchar(20) | required. Trimmed and upper-cased. Only `A–Z 0–9 _ -`, starting with a letter or digit. Unique across all rows, deleted ones included. Region codes are at most 10 characters, because they are stored in `students.centreCode`. |
| name | name | varchar(150) | required. Trimmed, NFC-normalised, spaces collapsed. Unique case-insensitively across all rows, deleted ones included. Caste names are at most 80 characters (`students.caste`). |
| description | description | varchar(500), nullable | optional |
| isMandatory | isMandatory | boolean, default false | document types only |
| isActive | isActive | boolean, default true | changed only by `PATCH /:id/status`. Editing never changes it. |
| isDelete | isDelete | boolean | soft delete only, never a hard delete |
| createdAt / updatedAt | createdAt / updatedAt | timestamptz | |

## Endpoints (`/api/v1`)

| Master | Path | Table | Permission prefix | Audit prefix |
|---|---|---|---|---|
| Region | `/regions` | regions | `regions.` | `master.region.` |
| Caste | `/castes` | castes | `castes.` | `master.caste.` |
| Document type | `/document-types` (not `/documents`, which would collide with `/students/:id/documents`) | document_types | `document-types.` | `master.document-type.` |
| Education | `/education` | educations | `education.` | `master.education.` |

Each master has the following routes:
- `GET /` (`view`): `page`, `limit`, `search` (matches code or name), `isActive`, `sortBy` (`createdAt|updatedAt|code|name`) and `sortOrder`.
- `GET /options` (public): active, non-deleted records only, sorted by name. Used by dropdowns and the registration form.
- `GET /:id` (`view`).
- `POST /` (`create`, idempotent).
- `PATCH /:id` (`update`).
- `PATCH /:id/status` (`status`).
- `DELETE /:id` (`delete`): soft delete.

Every write records an audit event in the same transaction.

## Rules

- Codes and names used by soft-deleted records stay reserved, so they cannot be created again (409).
- A record that a non-deleted student references cannot be deleted (409). Nor can its code be changed (409); its name and description can still be edited.
  - Region, caste and education references are `students.regionId`, `casteId` and `educationId`.
  - Document type references are a `documentTypeId` in `students.documents`, or a stored `student_documents` file with that `docType`.
- Deactivating a referenced record is allowed. It disappears from `/options`, from the import's matching, and from the registration API.

## Relationships

- `students.regionId → regions.id`, `students.casteId → castes.id`, `students.educationId → educations.id`. All three are nullable with ON DELETE RESTRICT. They were backfilled from `centreCode`, `caste` and `educationQualification`.
- A document type's `code` is the import column `doc_<code>` and the `student_documents.docType`.

## Seed (migration 1792700000000)

- **Regions:** the 36 former `CENTRES` (code, district name).
- **Castes:** the 27 former `CASTES`, with codes `C01`–`C27` in source order.
- **Document types:** the 13 former `DOCUMENTS`, with code = key and isMandatory = required:
  - `PAN_CARD` (PAN, optional);
  - `AADHAAR_CARD` (Aadhaar, mandatory);
  - `SCHOOL_LEAVING` (LC / Leaving Certificate, mandatory).
- **Education:** empty, because no list was supplied.
