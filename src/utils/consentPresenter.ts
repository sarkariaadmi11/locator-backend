import {ConsentRecord} from '@prisma/client';

export const presentConsentRecord = (record: ConsentRecord) => ({
  id: record.id,
  type: record.type,
  version: record.version,
  requestId: record.requestId,
  acceptedAt: record.acceptedAt.toISOString(),
});
