# Baseline migration

This migration represents the initial PostgreSQL baseline for Jobrolo before later feature migrations.

If production was created with `prisma db push`, this baseline should be marked as applied with:

```bash
npx prisma migrate resolve --applied 00000000000000_baseline --schema prisma/schema.prisma
```

Do not run this baseline directly against an existing database that already has the baseline tables.
