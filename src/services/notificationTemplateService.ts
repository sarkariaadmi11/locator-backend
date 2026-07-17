import {notificationTemplateRepository} from '../repositories/notificationTemplateRepository';
import {HttpError} from '../utils/httpError';
import {adminAuditLogService} from './adminAuditLogService';
import {NotificationType} from './notificationTypes';

const KNOWN_TYPES: Set<string> = new Set(Object.values(NotificationType));

/**
 * Notification Templates (PRD §5.14.9 "view/edit push notification template text incl. signup
 * welcome message; enable/disable specific triggers globally"). Every known `NotificationType`
 * is listed whether or not it has a template row yet — an Admin can add an override for any of
 * them; `notificationService.notifyUser`/`notifyAdmins` fall back to the caller's literal
 * title/body when no `enabled` template exists (see that file's `applyTemplate`).
 */
export const notificationTemplateService = {
  async listAll() {
    const rows = await notificationTemplateRepository.findAll();
    const byType = new Map(rows.map(r => [r.type, r]));

    return [...KNOWN_TYPES].sort().map(type => {
      const row = byType.get(type);
      return {
        type,
        title: row?.title ?? null,
        body: row?.body ?? null,
        enabled: row?.enabled ?? false,
        isOverridden: Boolean(row),
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  },

  async upsert(adminId: string, type: string, title: string, body: string, enabled: boolean) {
    if (!KNOWN_TYPES.has(type)) {
      throw new HttpError(404, `Unknown notification type "${type}".`);
    }
    const updated = await notificationTemplateRepository.upsert(type, title, body, enabled);
    await adminAuditLogService.log(adminId, 'NOTIFICATION_TEMPLATE_UPDATED', 'NotificationTemplate', type, {
      title,
      body,
      enabled,
    });
    return {
      type: updated.type,
      title: updated.title,
      body: updated.body,
      enabled: updated.enabled,
      isOverridden: true,
      updatedAt: updated.updatedAt.toISOString(),
    };
  },

  /** Reverts a type to "no override" — `notifyUser`/`notifyAdmins` fall back to the caller's literal text again. */
  async remove(adminId: string, type: string) {
    if (!KNOWN_TYPES.has(type)) {
      throw new HttpError(404, `Unknown notification type "${type}".`);
    }
    const existing = await notificationTemplateRepository.findByType(type);
    if (!existing) {
      throw new HttpError(404, `No template override exists for "${type}".`);
    }
    await notificationTemplateRepository.delete(type);
    await adminAuditLogService.log(adminId, 'NOTIFICATION_TEMPLATE_DELETED', 'NotificationTemplate', type, {});
  },
};
