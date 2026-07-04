import {Prisma} from '@prisma/client';

import {adminAuditLogRepository} from '../repositories/adminAuditLogRepository';

/** Immutable Admin/Moderator action log (PRD §5.14.7). Insert-only — never update or delete. */
export const adminAuditLogService = {
  async log(
    actorId: string,
    action: string,
    targetEntityType: string,
    targetEntityId: string,
    metadata?: Record<string, unknown>,
  ) {
    await adminAuditLogRepository.create({
      actor: {connect: {id: actorId}},
      action,
      targetEntityType,
      targetEntityId,
      metadata: (metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    });
  },

  async list(
    filters: {actorId?: string; targetEntityType?: string; targetEntityId?: string},
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;
    const [items, total] = await adminAuditLogRepository.findMany({...filters, skip, take: limit});

    return {
      items: items.map(entry => ({
        id: entry.id,
        actorId: entry.actorId,
        actor: entry.actor ? {id: entry.actor.id, name: entry.actor.name, email: entry.actor.email} : null,
        action: entry.action,
        targetEntityType: entry.targetEntityType,
        targetEntityId: entry.targetEntityId,
        metadata: entry.metadata,
        createdAt: entry.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },
};
