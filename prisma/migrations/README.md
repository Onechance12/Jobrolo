# Jobrolo Prisma migrations

Jobrolo production targets PostgreSQL.

Production migration rule:

```bash
npx prisma migrate deploy --schema prisma/schema.prisma
```

Do not use `prisma db push` for production data.

## Existing Render database note

If a Render Postgres database was originally bootstrapped with `prisma db push`, reconcile migration history before enabling automatic `migrate deploy`.

Inspect:

```bash
npx prisma migrate status --schema prisma/schema.prisma
```

If the baseline schema already exists in the database but is not recorded in `_prisma_migrations`, mark it applied:

```bash
npx prisma migrate resolve --applied 00000000000000_baseline --schema prisma/schema.prisma
```

Then apply pending migrations:

```bash
npx prisma migrate deploy --schema prisma/schema.prisma
```

Never run destructive migration commands such as `migrate reset` against production.
