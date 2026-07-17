import {env} from '../../config/env';
import {CloudinaryVideoStorageProvider} from './CloudinaryVideoStorageProvider';
import {IVideoStorageProvider} from './IVideoStorageProvider';
import {LocalVideoStorageProvider} from './LocalVideoStorageProvider';

// Single provider swap point (backend Phase 5 milestone: Cloudinary only, per explicit scope
// decision — see docs/MASTER_EXECUTION_PLAN.md Phase 5). TRD §5.10 specifies AWS S3 with
// pre-signed direct-to-client upload for the production architecture (see docs/SPEC_GAPS.md
// 2026-07-17 entry) — introducing that later means adding `S3VideoStorageProvider implements
// IVideoStorageProvider` and changing only this line. `MOCK_VIDEO_STORAGE_ENABLED` (dev-only,
// hard off outside NODE_ENV=development, see env.ts) swaps in a local-disk provider instead, so
// the upload pipeline can be live-tested without real Cloudinary/S3 credentials or a video file
// a real transcoder would accept.
export const videoStorageProvider: IVideoStorageProvider = env.MOCK_VIDEO_STORAGE_ENABLED
  ? new LocalVideoStorageProvider()
  : new CloudinaryVideoStorageProvider();

export type {IVideoStorageProvider, VideoUploadOptions, VideoUploadResult} from './IVideoStorageProvider';
