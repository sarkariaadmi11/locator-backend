import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const reportRepository = {
  create(data: Prisma.ReportCreateInput) {
    return prisma.report.create({data});
  },

  findExisting(reporterId: string, reportedUserId: string, requestId: string) {
    return prisma.report.findUnique({
      where: {reporterId_reportedUserId_requestId: {reporterId, reportedUserId, requestId}},
    });
  },

  findById(id: string) {
    return prisma.report.findUnique({
      where: {id},
      include: {
        reporter: {select: {id: true, name: true, username: true, profileImage: true}},
        reportedUser: {select: {id: true, name: true, username: true, profileImage: true, isSuspicious: true, isActive: true}},
        request: {select: {id: true, description: true, status: true}},
        resolvedByAdmin: {select: {id: true, name: true, email: true}},
      },
    });
  },

  findMany<T extends Prisma.ReportFindManyArgs>(
    params: Prisma.SelectSubset<T, Prisma.ReportFindManyArgs>,
  ): Prisma.PrismaPromise<Array<Prisma.ReportGetPayload<T>>> {
    return prisma.report.findMany(params);
  },

  count(where: Prisma.ReportWhereInput) {
    return prisma.report.count({where});
  },

  update(id: string, data: Prisma.ReportUpdateInput) {
    return prisma.report.update({where: {id}, data});
  },

  countAgainstUserSince(reportedUserId: string, since: Date) {
    return prisma.report.count({
      where: {reportedUserId, status: {in: ['PENDING', 'RESOLVED']}, createdAt: {gte: since}},
    });
  },

  groupStatsByStatus() {
    return prisma.report.groupBy({by: ['status'], _count: {_all: true}});
  },
};
