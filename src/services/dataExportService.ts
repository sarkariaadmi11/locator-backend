import {cloudinary} from '../config/cloudinary';
import {logger} from '../config/logger';
import {dataExportRequestRepository} from '../repositories/dataExportRequestRepository';
import {consentRecordRepository} from '../repositories/consentRecordRepository';
import {prisma} from '../prisma/client';
import {HttpError} from '../utils/httpError';
import {presentUser} from '../utils/userPresenter';
import {presentConsentRecord} from '../utils/consentPresenter';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';

const EXPORT_LINK_VALID_DAYS = 7;

/** One-off inline uploader (mirrors `profileService`/`disputeService`'s pattern) — a JSON export
 * bundle isn't a swappable-provider concern, so it doesn't need `IVideoStorageProvider`. */
function uploadExportToCloudinary(buffer: Buffer, userId: string): Promise<{secure_url: string}> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'locator/data-exports',
        resource_type: 'raw',
        public_id: `${userId}-${Date.now()}`,
        format: 'json',
      },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
        resolve(result);
      },
    );
    stream.end(buffer);
  });
}

async function buildExportBundle(userId: string) {
  const [user, requestsCreated, requestsFulfilled, transactions, ratingsGiven, ratingsReceived, reports, disputes, consent] =
    await Promise.all([
      prisma.user.findUnique({where: {id: userId}}),
      prisma.request.findMany({where: {requesterId: userId}, orderBy: {createdAt: 'desc'}}),
      prisma.request.findMany({where: {creatorId: userId}, orderBy: {createdAt: 'desc'}}),
      prisma.transaction.findMany({where: {userId}, orderBy: {createdAt: 'desc'}}),
      prisma.rating.findMany({where: {raterId: userId}}),
      prisma.rating.findMany({where: {rateeId: userId}}),
      prisma.report.findMany({where: {OR: [{reporterId: userId}, {reportedUserId: userId}]}}),
      prisma.dispute.findMany({where: {raisedById: userId}}),
      consentRecordRepository.findAllForUser(userId),
    ]);

  if (!user) {
    throw new HttpError(404, 'User not found.');
  }

  return {
    exportedAt: new Date().toISOString(),
    profile: presentUser(user),
    requestsCreated,
    requestsFulfilled,
    transactions,
    ratingsGiven,
    ratingsReceived,
    reports,
    disputes,
    consentHistory: consent.map(presentConsentRecord),
  };
}

/**
 * Right-to-access data export (PRD §9, DPDP-style). Generated synchronously — no job-queue lib
 * in this stack (same pragmatic pattern as every other scheduled/async-shaped feature here) and
 * a single user's own data is small enough not to need one.
 */
export const dataExportService = {
  async createExportRequest(userId: string) {
    const record = await dataExportRequestRepository.create({
      user: {connect: {id: userId}},
      status: 'PROCESSING',
    });

    try {
      const bundle = await buildExportBundle(userId);
      const buffer = Buffer.from(JSON.stringify(bundle, null, 2), 'utf-8');
      const result = await uploadExportToCloudinary(buffer, userId);
      const expiresAt = new Date(Date.now() + EXPORT_LINK_VALID_DAYS * 24 * 60 * 60 * 1000);

      const updated = await dataExportRequestRepository.update(record.id, {
        status: 'READY',
        fileUrl: result.secure_url,
        completedAt: new Date(),
        expiresAt,
      });

      await notificationService.notifyUser(
        userId,
        NotificationType.DATA_EXPORT_READY,
        'Your data export is ready',
        'Download your requested data export — the link expires in 7 days.',
        {screen: 'PrivacySettings'},
      );

      return this.present(updated);
    } catch (err) {
      logger.error(`[dataExportService.createExportRequest] Failed for user=${userId}: ${(err as Error).message}`);
      const failed = await dataExportRequestRepository.update(record.id, {
        status: 'FAILED',
        failureReason: 'Export generation failed. Please try again shortly.',
      });
      return this.present(failed);
    }
  },

  async listForUser(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [items, total] = await dataExportRequestRepository.findManyForUser(userId, skip, limit);
    return {
      items: items.map(this.present),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async getForUser(userId: string, id: string) {
    const record = await dataExportRequestRepository.findById(id);
    if (!record || record.userId !== userId) {
      throw new HttpError(404, 'Export request not found.');
    }
    return this.present(record);
  },

  present(record: {
    id: string;
    status: string;
    fileUrl: string | null;
    failureReason: string | null;
    requestedAt: Date;
    completedAt: Date | null;
    expiresAt: Date | null;
  }) {
    return {
      id: record.id,
      status: record.status,
      fileUrl: record.fileUrl,
      failureReason: record.failureReason,
      requestedAt: record.requestedAt.toISOString(),
      completedAt: record.completedAt?.toISOString() ?? null,
      expiresAt: record.expiresAt?.toISOString() ?? null,
    };
  },
};
