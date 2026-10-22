/* Runs before every test file, before any application module is imported. */
process.env.NODE_ENV = 'test';

/* LMS sign-in endpoints refuse unsigned calls; the tests sign with this test-only secret (.env.test values win if set). */
process.env.LMS_INTEGRATION_SECRET ??= 'db-test-lms-integration-secret-0123456789';
