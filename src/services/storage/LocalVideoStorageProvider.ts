import fs from 'fs/promises';
import path from 'path';

import {env} from '../../config/env';
import {IVideoStorageProvider, VideoUploadOptions, VideoUploadResult} from './IVideoStorageProvider';

const MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
};

/**
 * Dev-only mock of `IVideoStorageProvider` (gated by `env.MOCK_VIDEO_STORAGE_ENABLED`, same
 * hard-off-outside-development pattern as `MOCK_OTP`). Writes the uploaded buffer to local disk
 * under `UPLOAD_DIR/videos/` and serves it via the app's existing static `/uploads` route, so the
 * recording→upload→moderation→completion flow can be exercised live with a synthetic test file
 * that a real transcoder (Cloudinary/S3) would correctly reject as not-a-video. Never used in
 * production — `storage/index.ts` only selects this when the flag is on, which `env.ts` refuses
 * to allow outside `NODE_ENV=development`.
 */
export class LocalVideoStorageProvider implements IVideoStorageProvider {
  async uploadVideo(buffer: Buffer, options: VideoUploadOptions): Promise<VideoUploadResult> {
    const ext = MIME_TO_EXT[options.mimeType] ?? 'mp4';
    const relativeDir = path.join('videos', options.requestId);
    const relativePath = path.join(relativeDir, `${options.videoId}.${ext}`);
    const absoluteDir = path.resolve(process.cwd(), env.UPLOAD_DIR, relativeDir);
    const absolutePath = path.resolve(process.cwd(), env.UPLOAD_DIR, relativePath);

    await fs.mkdir(absoluteDir, {recursive: true});
    await fs.writeFile(absolutePath, buffer);

    const publicId = `local:${relativePath.split(path.sep).join('/')}`;

    return {
      publicId,
      secureUrl: `/${env.UPLOAD_DIR}/${relativePath.split(path.sep).join('/')}`,
      thumbnailUrl: null,
      durationSeconds: options.durationSeconds,
      width: null,
      height: null,
      fileSizeBytes: buffer.length,
      mimeType: options.mimeType,
    };
  }

  async deleteVideo(publicId: string): Promise<void> {
    if (!publicId.startsWith('local:')) return;
    const relativePath = publicId.slice('local:'.length);
    const absolutePath = path.resolve(process.cwd(), env.UPLOAD_DIR, relativePath);
    await fs.rm(absolutePath, {force: true});
  }
}
