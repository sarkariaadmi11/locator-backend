import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const queryRepository = {
  findThread(requestId: string, creatorId: string) {
    return prisma.preAcceptanceQuery.findUnique({
      where: {requestId_creatorId: {requestId, creatorId}},
      include: {messages: {orderBy: {createdAt: 'asc'}}},
    });
  },

  findThreadById(threadId: string) {
    return prisma.preAcceptanceQuery.findUnique({
      where: {id: threadId},
      include: {messages: {orderBy: {createdAt: 'asc'}}},
    });
  },

  findAllThreadsForRequest(requestId: string) {
    return prisma.preAcceptanceQuery.findMany({
      where: {requestId},
      include: {messages: {orderBy: {createdAt: 'asc'}}},
      orderBy: {createdAt: 'asc'},
    });
  },

  createThread(requestId: string, creatorId: string) {
    return prisma.preAcceptanceQuery.create({data: {requestId, creatorId}});
  },

  addMessage(queryId: string, senderId: string, body: string, blocked: boolean) {
    return prisma.preAcceptanceQueryMessage.create({data: {queryId, senderId, body, blocked}});
  },

  incrementExchangeCount(threadId: string) {
    return prisma.preAcceptanceQuery.update({where: {id: threadId}, data: {exchangeCount: {increment: 1}}});
  },

  updateThreadStatus(threadId: string, status: Prisma.PreAcceptanceQueryUpdateInput['status']) {
    return prisma.preAcceptanceQuery.update({where: {id: threadId}, data: {status}});
  },

  closeAllOpenForRequest(requestId: string) {
    return prisma.preAcceptanceQuery.updateMany({
      where: {requestId, status: 'OPEN'},
      data: {status: 'CLOSED_ACCEPTED'},
    });
  },
};
