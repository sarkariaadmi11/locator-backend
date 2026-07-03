import {config} from 'dotenv';
config();

import bcrypt from 'bcrypt';
import {prisma} from '../prisma/client';

const [, , name, email, password] = process.argv;

if (!name || !email || !password) {
  console.error('Usage: npx ts-node src/scripts/createAdmin.ts <name> <email> <password>');
  process.exit(1);
}

async function main() {
  const existing = await prisma.admin.findUnique({where: {email}});
  if (existing) {
    console.error(`Admin with email "${email}" already exists.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.admin.create({
    data: {name, email, password: passwordHash},
  });

  console.log('Admin created successfully:');
  console.log(`  ID:    ${admin.id}`);
  console.log(`  Name:  ${admin.name}`);
  console.log(`  Email: ${admin.email}`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
