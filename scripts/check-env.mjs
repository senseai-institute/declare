// Fail fast with a readable message instead of a stack trace on first deploy.
if (!process.env.DATABASE_URL) {
  console.error(
    '\n✗ DATABASE_URL is not set.\n' +
      '  On Railway: add the PostgreSQL plugin, then on this service set\n' +
      '  DATABASE_URL = ${{Postgres.DATABASE_URL}}  (Variables tab).\n',
  );
  process.exit(1);
}
