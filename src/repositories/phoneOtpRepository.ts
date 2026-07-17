import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const phoneOtpRepository = {
  findByPhone(phone: string) {
    return prisma.phoneOtp.findUnique({where: {phone}});
  },

  /** One live OTP per phone (PRD §5.1.2) — a fresh request always replaces any pending row. */
  upsertForPhone(
    phone: string,
    data: Omit<Prisma.PhoneOtpCreateInput, 'phone'>,
  ) {
    return prisma.phoneOtp.upsert({
      where: {phone},
      create: {phone, ...data},
      update: {...data, attempts: 0, lockedUntil: null},
    });
  },

  incrementAttempts(id: string) {
    return prisma.phoneOtp.update({
      where: {id},
      data: {attempts: {increment: 1}},
    });
  },

  lock(id: string, lockedUntil: Date) {
    return prisma.phoneOtp.update({where: {id}, data: {lockedUntil}});
  },

  delete(phone: string) {
    return prisma.phoneOtp.deleteMany({where: {phone}});
  },

  /** Inactive-account cleanup sweep parity (backend Phase 13 pattern) — expired rows are clutter. */
  deleteExpired(now: Date) {
    return prisma.phoneOtp.deleteMany({where: {expiresAt: {lte: now}}});
  },
};
