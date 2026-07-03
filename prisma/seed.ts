import {config} from 'dotenv';
config();

import {seedAdmins} from '../src/utils/seedAdmins';
import {prisma} from '../src/prisma/client';

seedAdmins()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
