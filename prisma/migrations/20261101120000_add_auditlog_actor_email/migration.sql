-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorEmail" TEXT;

-- Backfill every row whose author still exists. Rows of admins removed before
-- this migration already lost their userId, so their author cannot be recovered.
UPDATE "AuditLog" AS a
SET "actorEmail" = u."email"
FROM "User" AS u
WHERE a."userId" = u."id";
