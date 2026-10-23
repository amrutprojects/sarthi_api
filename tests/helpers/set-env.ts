/* Runs before every test file, before any application module is imported. */
process.env.NODE_ENV = 'test';

/*
 * Tests never use the development file store. The student-documents e2e suite deletes storageRoot()
 * outright, and STORAGE_DIR defaults to 'storage' — the folder the running dev server keeps uploaded
 * documents and board member photos in. dotenv never overrides a variable that is already set, so
 * this wins over .env.test; export STORAGE_DIR before running the tests to choose another folder.
 */
if (!process.env.STORAGE_DIR) process.env.STORAGE_DIR = 'storage-test';
