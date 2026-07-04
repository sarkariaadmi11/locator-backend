/**
 * Storage-agnostic video upload contract (backend Phase 5, PRD §5.6). `recordingService` and
 * `requestService` only ever talk to this interface — never to a concrete provider — so
 * swapping Cloudinary (this milestone) for `S3VideoStorageProvider` later needs no business
 * logic changes, only a new implementation of this file plus the export in `index.ts`.
 */
export type VideoUploadOptions = {
  requestId: string;
  videoId: string;
};

export type VideoUploadResult = {
  publicId: string;
  secureUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  fileSizeBytes: number;
  mimeType: string;
};

export interface IVideoStorageProvider {
  /** Uploads a video buffer and returns metadata + a generated thumbnail. */
  uploadVideo(buffer: Buffer, options: VideoUploadOptions): Promise<VideoUploadResult>;

  /** Deletes a previously uploaded video by its provider-specific public id. */
  deleteVideo(publicId: string): Promise<void>;
}
