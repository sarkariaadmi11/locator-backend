import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';

export const restrictedLocationRepository = {
  create(data: Prisma.RestrictedLocationCreateInput) {
    return prisma.restrictedLocation.create({data});
  },

  findById(id: string) {
    return prisma.restrictedLocation.findUnique({where: {id}});
  },

  findMany(skip: number, take: number) {
    return prisma.restrictedLocation.findMany({
      orderBy: {createdAt: 'desc'},
      skip,
      take,
    });
  },

  count() {
    return prisma.restrictedLocation.count();
  },

  /** Unpaginated — used by the classification engine to scan all entries for a radius match. */
  findAll() {
    return prisma.restrictedLocation.findMany();
  },

  update(id: string, data: Prisma.RestrictedLocationUpdateInput) {
    return prisma.restrictedLocation.update({where: {id}, data});
  },

  delete(id: string) {
    return prisma.restrictedLocation.delete({where: {id}});
  },
};
