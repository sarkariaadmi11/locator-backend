import bcrypt from 'bcrypt';
import {env} from '../config/env';
import {prisma} from '../prisma/client';

export async function seedAdmins() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.log('  ↳ Skipped (database unavailable)');
    return;
  }

  console.log('Seeding admins…');

  try {
    const existing = await prisma.admin.findUnique({where: {email: env.ADMIN_EMAIL}});

    if (existing) {
      console.log(`  ↳ Skipped (already exists): ${env.ADMIN_EMAIL}`);
      return;
    }

    const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12);
    const created = await prisma.admin.create({
      data: {name: env.ADMIN_NAME, email: env.ADMIN_EMAIL, password: passwordHash},
    });

    console.log(`  ↳ Created: ${created.email} (id: ${created.id})`);
    console.log('Done.');
  } catch (err) {
    console.log(`  ↳ Skipped (${(err as Error).message})`);
  }
}
