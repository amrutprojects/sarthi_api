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
/* LMS sign-in endpoints refuse unsigned calls; the tests sign with this test-only secret (.env.test values win if set). */
process.env.LMS_INTEGRATION_SECRET ??= 'db-test-lms-integration-secret-0123456789';
/* No LMS tenant code is preset in the app (entered by hand per installation); the DB tests use an explicit test code. */
process.env.LMS_TENANT_CODE ??= 'TEST_TENANT';
/*
 * The link with IPP is off; its tests switch it on themselves against a local fake (Object.assign on env). Plain assignment:
 * no value of .env.test or the shell may ever send a test's decisions to a real IPP.
 */
process.env.IPP_LINK_ENABLED = 'false';
process.env.IPP_API_URL = '';
process.env.IPP_LINK_SECRET = '';
/* The EDP portal tests sign up and sign in many times per file; its per-IP limit is not what they test. */
process.env.EDP_RATE_LIMIT_MAX ??= '1000';
/* The contact the portal shows after submitting; the tests check it reaches the portal. */
process.env.EDP_SUPPORT_EMAIL ??= 'edp.help@example.invalid';
process.env.EDP_SUPPORT_MOBILE ??= '+91 80000 00000';
