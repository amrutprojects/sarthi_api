/* Runs before every test file, before any application module is imported. */
process.env.NODE_ENV = 'test';

/*
 * Tests get their own storage. The student-documents e2e test deletes STORAGE_DIR, and the development
 * DOCUMENT_STORAGE_DIR (storage/documents — Document Master files and LMS logos) sits inside the development
 * STORAGE_DIR (storage). Plain assignment, not ??=: a value exported in the shell must never point the test's
 * rmSync at real files, and dotenv never overrides a variable that is already set, so .env.test cannot either.
 * storage-test/ is git-ignored.
 */
process.env.STORAGE_DIR = 'storage-test';
process.env.DOCUMENT_STORAGE_DIR = 'storage-test/documents';
/* …and always on the local disk: an s3 driver from .env.test or the shell would send test writes and deletes to a real bucket. */
process.env.STORAGE_DRIVER = 'local';
