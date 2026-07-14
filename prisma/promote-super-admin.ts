// One-time admin promotion utility (B7c).
//
// getAdminContext() upserts a Prisma `User` row (role ADMIN) on a user's first
// authenticated admin request. To make a user a SUPER_ADMIN:
//   1. Log into the admin panel once (this creates their User row as ADMIN).
//   2. Run:  npx tsx --env-file .env.local prisma/promote-super-admin.ts <email>
// (Alternatively, run a manual UPDATE in the Supabase SQL editor.)
//
// The User-invite UI that assigns roles/centres is deferred to a later phase.

import { PrismaClient } from "../generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.argv[2] ?? process.env.SUPER_ADMIN_EMAIL;
  if (!email) {
    console.error("Usage: tsx --env-file .env.local prisma/promote-super-admin.ts <email>");
    process.exit(1);
  }

  const res = await prisma.user.updateMany({
    where: { email },
    data: { role: "SUPER_ADMIN" },
  });

  console.log(JSON.stringify({ email, promoted: res.count }));
  if (res.count === 0) {
    console.log(
      "No matching User row yet — log into the admin panel once (creates it as ADMIN), then re-run.",
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
