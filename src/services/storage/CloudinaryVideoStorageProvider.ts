import {cloudinary} from '../../config/cloudinary';
import {IVideoStorageProvider, VideoUploadOptions, VideoUploadResult} from './IVideoStorageProvider';

type CloudinaryVideoUploadApiResponse = {
  public_id: string;
  secure_url: string;
  duration?: number;
  width?: number;
  height?: number;
  bytes: number;
  format: string;
  resource_type: string;
  eager?: {secure_url: string}[];
};

/**
 * Cloudinary implementation of `IVideoStorageProvider` (backend Phase 5). Requests an eager
 * thumbnail transformation at upload time so a JPEG frame is ready the moment the upload
 * completes, rather than needing a second derived-URL request.
 */
export class CloudinaryVideoStorageProvider implements IVideoStorageProvider {
  uploadVideo(buffer: Buffer, options: VideoUploadOptions): Promise<VideoUploadResult> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `locator/request-videos/${options.requestId}`,
          public_id: options.videoId,
          resource_type: 'video',
          overwrite: true,
          eager: [{width: 400, height: 400, crop: 'fill', format: 'jpg', start_offset: '0'}],
          eager_async: false,
        },
        (error, result) => {
          if (error || !result) {
            reject(error ?? new Error('Cloudinary video upload failed'));
            return;
          }

          const uploaded = result as unknown as CloudinaryVideoUploadApiResponse;
          resolve({
            publicId: uploaded.public_id,
            secureUrl: uploaded.secure_url,
            thumbnailUrl: uploaded.eager?.[0]?.secure_url ?? null,
            durationSeconds: uploaded.duration ?? null,
            width: uploaded.width ?? null,
            height: uploaded.height ?? null,
            fileSizeBytes: uploaded.bytes,
            mimeType: `video/${uploaded.format}`,
          });
        },
      );
      stream.end(buffer);
    });
  }

  async deleteVideo(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId, {resource_type: 'video'});
  }
}
