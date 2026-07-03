import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const registrationOtpRepository = {
  create(data: Prisma.RegistrationOtpCreateInput) {
    return prisma.registrationOtp.create({data});
  },

  deletePendingForEmail(email: string) {
    return prisma.registrationOtp.deleteMany({where: {email}});
  },

  findLatestByEmail(email: string) {
    return prisma.registrationOtp.findFirst({
      where: {email},
      orderBy: {createdAt: 'desc'},
    });
  },

  incrementAttempts(id: string) {
    return prisma.registrationOtp.update({
      where: {id},
      data: {attempts: {increment: 1}},
    });
  },

  delete(id: string) {
    return prisma.registrationOtp.delete({where: {id}});
  },
};
