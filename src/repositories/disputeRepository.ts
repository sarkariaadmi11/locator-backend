import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

const detailInclude = {
  request: {
    select: {
      id: true,
      description: true,
      status: true,
      requesterId: true,
      creatorId: true,
      latitude: true,
      longitude: true,
      radiusMeters: true,
      acceptedAt: true,
      expiresAt: true,
    },
  },
  raisedBy: {select: {id: true, name: true, username: true, profileImage: true}},
  resolvedByAdmin: {select: {id: true, name: true, email: true}},
  caseOwnerAdmin: {select: {id: true, name: true, email: true}},
  messages: {orderBy: {createdAt: 'asc' as const}, include: {
    authorUser: {select: {id: true, name: true, username: true}},
    authorAdmin: {select: {id: true, name: true}},
  }},
  evidence: {orderBy: {createdAt: 'asc' as const}, include: {
    uploadedByUser: {select: {id: true, name: true, username: true}},
    uploadedByAdmin: {select: {id: true, name: true}},
  }},
} satisfies Prisma.DisputeInclude;

export const disputeRepository = {
  create(data: Prisma.DisputeCreateInput) {
    return prisma.dispute.create({data, include: detailInclude});
  },

  findByRequestId(requestId: string) {
    return prisma.dispute.findUnique({where: {requestId}});
  },

  findById(id: string) {
    return prisma.dispute.findUnique({where: {id}, include: detailInclude});
  },

  findMany<T extends Prisma.DisputeFindManyArgs>(
    params: Prisma.SelectSubset<T, Prisma.DisputeFindManyArgs>,
  ): Prisma.PrismaPromise<Array<Prisma.DisputeGetPayload<T>>> {
    return prisma.dispute.findMany(params);
  },

  count(where: Prisma.DisputeWhereInput) {
    return prisma.dispute.count({where});
  },

  update(id: string, data: Prisma.DisputeUpdateInput) {
    return prisma.dispute.update({where: {id}, data, include: detailInclude});
  },

  groupStatsByStatus() {
    return prisma.dispute.groupBy({by: ['status'], _count: {_all: true}});
  },

  createMessage(data: Prisma.DisputeMessageCreateInput) {
    return prisma.disputeMessage.create({
      data,
      include: {
        authorUser: {select: {id: true, name: true, username: true}},
        authorAdmin: {select: {id: true, name: true}},
      },
    });
  },

  createEvidence(data: Prisma.DisputeEvidenceCreateInput) {
    return prisma.disputeEvidence.create({
      data,
      include: {
        uploadedByUser: {select: {id: true, name: true, username: true}},
        uploadedByAdmin: {select: {id: true, name: true}},
      },
    });
  },
};
