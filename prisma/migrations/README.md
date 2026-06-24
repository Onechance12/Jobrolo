# Jobrolo Prisma migrations

Phase 12 moves the production schema target to PostgreSQL. The uploaded package does not include a generated SQL baseline because it is produced against the target Prisma engine/database during setup.

After configuring `DATABASE_URL=postgresql://...`, run:

```bash
npx prisma generate
npx prisma migrate dev --name baseline
```

Commit the generated `prisma/migrations/<timestamp>_baseline/migration.sql` before deploying.

For production deployments, use:

```bash
npx prisma migrate deploy
```

Do not use `prisma db push` for production data.

A dev-only copy of the old SQLite schema is kept at `prisma/schema.sqlite.prisma` for reference while migrating.
