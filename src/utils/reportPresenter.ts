import {reportRepository} from '../repositories/reportRepository';

type ReportDetail = NonNullable<Awaited<ReturnType<typeof reportRepository.findById>>>;

export const presentReportDetail = (report: ReportDetail) => ({
  id: report.id,
  reporterId: report.reporterId,
  reporter: report.reporter,
  reportedUserId: report.reportedUserId,
  reportedUser: report.reportedUser,
  requestId: report.requestId,
  request: report.request,
  category: report.category,
  description: report.description,
  evidence: report.evidence,
  status: report.status,
  resolutionNotes: report.resolutionNotes,
  resolvedByAdminId: report.resolvedByAdminId,
  resolvedByAdmin: report.resolvedByAdmin,
  resolvedAt: report.resolvedAt?.toISOString() ?? null,
  createdAt: report.createdAt.toISOString(),
  updatedAt: report.updatedAt.toISOString(),
});

// Own-filed report (`POST /reports` response, requester/creator-facing) — no Admin-only fields.
export const presentReport = (report: {
  id: string;
  reporterId: string;
  reportedUserId: string;
  requestId: string;
  category: string;
  description: string;
  evidence: string[];
  status: string;
  createdAt: Date;
}) => ({
  id: report.id,
  reporterId: report.reporterId,
  reportedUserId: report.reportedUserId,
  requestId: report.requestId,
  category: report.category,
  description: report.description,
  evidence: report.evidence,
  status: report.status,
  createdAt: report.createdAt.toISOString(),
});
