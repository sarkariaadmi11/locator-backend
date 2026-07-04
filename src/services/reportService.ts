import {ReportCategory} from '@prisma/client';

import {reportRepository} from '../repositories/reportRepository';
import {requestRepository} from '../repositories/requestRepository';
import {userRepository} from '../repositories/userRepository';
import {HttpError} from '../utils/httpError';
import {presentReport, presentReportDetail} from '../utils/reportPresenter';
import {adminAuditLogService} from './adminAuditLogService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {REPORT_AUTO_SUSPEND_THRESHOLD, REPORT_AUTO_SUSPEND_WINDOW_DAYS} from '../validations/reportValidation';

/** Categories severe enough to alert Admins immediately, not just at report-list-review time. */
const HIGH_PRIORITY_REPORT_CATEGORIES = new Set(['ABUSE', 'FAKE_RECORDING']);

/**
 * If a user has crossed the report threshold within the trailing window, flag the existing
 * `isSuspicious` field (reused as-is, per CLAUDE.md "reuse existing" instruction — this is the
 * same flag `adminService.toggleSuspicious`/the Admin user-list filter already surface) so the
 * user shows up for Admin review without a new suspension mechanism or a scheduled job — this
 * check runs inline at report-creation time, "without manual polling" (backend Phase 9 exit
 * criteria).
 */
async function maybeFlagForSuspensionReview(reportedUserId: string) {
  const since = new Date(Date.now() - REPORT_AUTO_SUSPEND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const recentCount = await reportRepository.countAgainstUserSince(reportedUserId, since);
  if (recentCount < REPORT_AUTO_SUSPEND_THRESHOLD) return;

  const user = await userRepository.findById(reportedUserId);
  if (user && !user.isSuspicious) {
    await userRepository.update(reportedUserId, {isSuspicious: true});
    await notificationService.notifyAdmins(
      NotificationType.SUSPICIOUS_USER,
      'Suspicious user flagged',
      `${user.name} was flagged for review after ${REPORT_AUTO_SUSPEND_THRESHOLD}+ reports in ${REPORT_AUTO_SUSPEND_WINDOW_DAYS} days.`,
      {userId: reportedUserId},
    );
  }
}

/** Report/Abuse workflow (PRD §5.12, backend Phase 9). */
export const reportService = {
  /**
   * `POST /reports` — reporter and reportedUser must both be participants of the same request,
   * on opposite sides (Requester reports Creator, or vice versa; PRD's exact business rule).
   * Duplicate prevention is DB-unique on (reporterId, reportedUserId, requestId).
   */
  async create(
    reporterId: string,
    input: {reportedUserId: string; requestId: string; category: ReportCategory; description: string; evidence?: string[]},
  ) {
    const request = await requestRepository.findById(input.requestId);
    if (!request) {
      throw new HttpError(404, 'Request not found.');
    }

    const isRequesterReportingCreator = request.requesterId === reporterId && request.creatorId === input.reportedUserId;
    const isCreatorReportingRequester = request.creatorId === reporterId && request.requesterId === input.reportedUserId;
    if (!isRequesterReportingCreator && !isCreatorReportingRequester) {
      throw new HttpError(403, 'You can only report the other participant of this request.');
    }

    const existing = await reportRepository.findExisting(reporterId, input.reportedUserId, input.requestId);
    if (existing) {
      throw new HttpError(409, 'You have already reported this user for this request.');
    }

    const report = await reportRepository.create({
      reporter: {connect: {id: reporterId}},
      reportedUser: {connect: {id: input.reportedUserId}},
      request: {connect: {id: input.requestId}},
      category: input.category,
      description: input.description,
      evidence: input.evidence ?? [],
    });

    await maybeFlagForSuspensionReview(input.reportedUserId);

    await notificationService.notifyUser(
      reporterId,
      NotificationType.REPORT_SUBMITTED,
      'Report submitted',
      'Your report has been submitted and will be reviewed by our team.',
      {requestId: input.requestId, reportId: report.id, screen: 'RequestDetail'},
    );
    if (HIGH_PRIORITY_REPORT_CATEGORIES.has(input.category)) {
      await notificationService.notifyAdmins(
        NotificationType.HIGH_PRIORITY_REPORT,
        'High priority report submitted',
        `A ${input.category.replace('_', ' ').toLowerCase()} report requires urgent review.`,
        {requestId: input.requestId, reportId: report.id},
      );
    }

    return presentReport(report);
  },

  // --- Admin (PRD §5.14, Report Queue / Detail / Resolve / Dismiss / Statistics) ----------

  async adminList(
    filters: {status?: 'PENDING' | 'RESOLVED' | 'DISMISSED'; category?: ReportCategory; reportedUserId?: string; reporterId?: string},
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;
    const where = {
      ...(filters.status ? {status: filters.status} : {}),
      ...(filters.category ? {category: filters.category} : {}),
      ...(filters.reportedUserId ? {reportedUserId: filters.reportedUserId} : {}),
      ...(filters.reporterId ? {reporterId: filters.reporterId} : {}),
    };

    const [items, total] = await Promise.all([
      reportRepository.findMany({
        where,
        orderBy: {createdAt: 'desc'},
        skip,
        take: limit,
        include: {
          reporter: {select: {id: true, name: true, username: true}},
          reportedUser: {select: {id: true, name: true, username: true, isSuspicious: true, isActive: true}},
          request: {select: {id: true, description: true, status: true}},
        },
      }),
      reportRepository.count(where),
    ]);

    return {
      items: items.map(item => ({
        id: item.id,
        reporterId: item.reporterId,
        reporter: item.reporter,
        reportedUserId: item.reportedUserId,
        reportedUser: item.reportedUser,
        requestId: item.requestId,
        request: item.request,
        category: item.category,
        description: item.description,
        status: item.status,
        createdAt: item.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async adminDetail(id: string) {
    const report = await reportRepository.findById(id);
    if (!report) {
      throw new HttpError(404, 'Report not found.');
    }

    const since = new Date(Date.now() - REPORT_AUTO_SUSPEND_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const recentReportCount = await reportRepository.countAgainstUserSince(report.reportedUserId, since);

    return {
      ...presentReportDetail(report),
      suspendRecommended: recentReportCount >= REPORT_AUTO_SUSPEND_THRESHOLD,
      recentReportCount,
    };
  },

  async resolve(adminId: string, id: string, notes: string | undefined) {
    const report = await reportRepository.findById(id);
    if (!report) {
      throw new HttpError(404, 'Report not found.');
    }
    if (report.status !== 'PENDING') {
      throw new HttpError(409, `This report has already been ${report.status.toLowerCase()}.`);
    }

    const updated = await reportRepository.update(id, {
      status: 'RESOLVED',
      resolutionNotes: notes ?? null,
      resolvedByAdmin: {connect: {id: adminId}},
      resolvedAt: new Date(),
    });

    await adminAuditLogService.log(adminId, 'REPORT_RESOLVED', 'Report', id, {reportedUserId: report.reportedUserId});

    await notificationService.notifyUser(
      report.reporterId,
      NotificationType.REPORT_RESOLVED,
      'Report resolved',
      'Your report has been reviewed and resolved by our team.',
      {reportId: id, screen: 'RequestDetail'},
    );

    const detail = await reportRepository.findById(updated.id);
    return presentReportDetail(detail!);
  },

  async dismiss(adminId: string, id: string, notes: string | undefined) {
    const report = await reportRepository.findById(id);
    if (!report) {
      throw new HttpError(404, 'Report not found.');
    }
    if (report.status !== 'PENDING') {
      throw new HttpError(409, `This report has already been ${report.status.toLowerCase()}.`);
    }

    const updated = await reportRepository.update(id, {
      status: 'DISMISSED',
      resolutionNotes: notes ?? null,
      resolvedByAdmin: {connect: {id: adminId}},
      resolvedAt: new Date(),
    });

    await adminAuditLogService.log(adminId, 'REPORT_DISMISSED', 'Report', id, {reportedUserId: report.reportedUserId});

    await notificationService.notifyUser(
      report.reporterId,
      NotificationType.REPORT_UPDATED,
      'Report updated',
      'Your report has been reviewed — no action was taken.',
      {reportId: id, screen: 'RequestDetail'},
    );

    const detail = await reportRepository.findById(updated.id);
    return presentReportDetail(detail!);
  },

  /** Report Queue statistics (PRD §5.14). */
  async adminStats() {
    const grouped = await reportRepository.groupStatsByStatus();
    const byStatus: Record<'PENDING' | 'RESOLVED' | 'DISMISSED', number> = {PENDING: 0, RESOLVED: 0, DISMISSED: 0};
    for (const row of grouped) {
      byStatus[row.status] = row._count._all;
    }
    return {
      pending: byStatus.PENDING,
      resolved: byStatus.RESOLVED,
      dismissed: byStatus.DISMISSED,
      total: byStatus.PENDING + byStatus.RESOLVED + byStatus.DISMISSED,
    };
  },
};
