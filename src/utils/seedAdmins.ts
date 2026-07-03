import bcrypt from 'bcrypt';
import {env} from '../config/env';
import {prisma} from '../prisma/client';

export async function seedAdmins() {
  console.log('Seeding admins…');

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
}
