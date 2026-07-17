import {MatchingWindowReservationStatus, Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const matchingWindowResponseRepository = {
  create(data: Prisma.MatchingWindowResponseUncheckedCreateInput) {
    return prisma.matchingWindowResponse.create({data});
  },

  findManyForRequest(requestId: string) {
    return prisma.matchingWindowResponse.findMany({
      where: {requestId},
      include: {creator: {select: {id: true, name: true, username: true}}},
      orderBy: {respondedAt: 'asc'},
    });
  },

  findOne(requestId: string, creatorId: string) {
    return prisma.matchingWindowResponse.findUnique({
      where: {requestId_creatorId: {requestId, creatorId}},
    });
  },

  updateStatus(id: string, status: MatchingWindowReservationStatus) {
    return prisma.matchingWindowResponse.update({where: {id}, data: {connectReservationStatus: status}});
  },
};
