import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const postSubmissionChatRepository = {
  findByRequestId(requestId: string) {
    return prisma.postSubmissionChatMessage.findMany({where: {requestId}, orderBy: {createdAt: 'asc'}});
  },

  create(data: Prisma.PostSubmissionChatMessageCreateInput) {
    return prisma.postSubmissionChatMessage.create({data});
  },

  countBlocked(requestId: string) {
    return prisma.postSubmissionChatMessage.count({where: {requestId, blockedAttempt: true}});
  },
};
