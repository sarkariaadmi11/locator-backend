import {prisma} from '../prisma/client';

export const refreshTokenRepository = {
  create(data: {userId: string; tokenHash: string; familyId: string; expiresAt: Date}) {
    return prisma.refreshToken.create({data});
  },

  findByHash(tokenHash: string) {
    return prisma.refreshToken.findUnique({where: {tokenHash}});
  },

  /** Rotation: mark the used token consumed and point it at its replacement. */
  markRotated(id: string, replacedByHash: string) {
    return prisma.refreshToken.update({
      where: {id},
      data: {revokedAt: new Date(), replacedByHash},
    });
  },

  revoke(id: string) {
    return prisma.refreshToken.update({where: {id}, data: {revokedAt: new Date()}});
  },

  /** Reuse-detection breach response (PRD §11 "Security — Auth") — revoke the whole token family. */
  revokeFamily(familyId: string) {
    return prisma.refreshToken.updateMany({
      where: {familyId, revokedAt: null},
      data: {revokedAt: new Date()},
    });
  },

  revokeAllForUser(userId: string) {
    return prisma.refreshToken.updateMany({
      where: {userId, revokedAt: null},
      data: {revokedAt: new Date()},
    });
  },

  deleteExpired(now: Date) {
    return prisma.refreshToken.deleteMany({where: {expiresAt: {lte: now}}});
  },
};
