import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const adminRepository = {
  create(data: Prisma.AdminCreateInput) {
    return prisma.admin.create({data});
  },

  findByEmail(email: string) {
    return prisma.admin.findUnique({where: {email}});
  },

  findById(id: string) {
    return prisma.admin.findUnique({where: {id}});
  },
};
