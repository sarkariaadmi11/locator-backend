import {prisma} from '../prisma/client';

export const passwordResetOtpRepository = {
  create(data: {email: string; otpHash: string; expiresAt: Date}) {
    return prisma.passwordResetOtp.create({data});
  },

  deletePendingForEmail(email: string) {
    return prisma.passwordResetOtp.deleteMany({where: {email}});
  },

  findLatestByEmail(email: string) {
    return prisma.passwordResetOtp.findFirst({
      where: {email},
      orderBy: {createdAt: 'desc'},
    });
  },

  incrementAttempts(id: string) {
    return prisma.passwordResetOtp.update({
      where: {id},
      data: {attempts: {increment: 1}},
    });
  },

  delete(id: string) {
    return prisma.passwordResetOtp.delete({where: {id}});
  },
};
