/*
 * Safety net: test helpers reset tables, so they refuse to run against anything that is not
 * clearly a test database.
 */
export function assertTestDatabase(database: string | undefined, nodeEnv = process.env.NODE_ENV): void {
  if (nodeEnv !== 'test') throw new Error(`Refusing to run tests with NODE_ENV=${nodeEnv}`);
  if (!database || !/test/i.test(database)) {
    throw new Error(`Refusing to reset database "${database}": its name must contain "test" (configure .env.test)`);
  }
}
