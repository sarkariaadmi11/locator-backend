import {Prisma, RequestStatus} from '@prisma/client';

import {prisma} from '../prisma/client';

export const chatRepository = {
  create(data: Prisma.ChatMessageCreateInput) {
    return prisma.chatMessage.create({data});
  },

  findByRequestId(requestId: string) {
    return prisma.chatMessage.findMany({where: {requestId}, orderBy: {createdAt: 'asc'}});
  },

  countBlocked(requestId: string) {
    return prisma.chatMessage.count({where: {requestId, blocked: true}});
  },

  /**
   * Chat retention purge (PRD §9, backend Phase 13) — deletes messages belonging to requests
   * that reached a terminal state at least `cutoff` ago. `updatedAt` on `Request` is the proxy
   * for "when it closed" since every terminal transition touches that row.
   */
  deleteOlderThanForClosedRequests(cutoff: Date, terminalStatuses: RequestStatus[]) {
    return prisma.chatMessage.deleteMany({
      where: {request: {status: {in: terminalStatuses}, updatedAt: {lte: cutoff}}},
    });
  },
};
