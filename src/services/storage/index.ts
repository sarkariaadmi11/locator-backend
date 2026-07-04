import {CloudinaryVideoStorageProvider} from './CloudinaryVideoStorageProvider';
import {IVideoStorageProvider} from './IVideoStorageProvider';

// Single provider swap point (backend Phase 5 milestone: Cloudinary only, per explicit scope
// decision — see docs/MASTER_EXECUTION_PLAN.md Phase 5). Introducing S3 later means adding
// `S3VideoStorageProvider implements IVideoStorageProvider` and changing only this line.
export const videoStorageProvider: IVideoStorageProvider = new CloudinaryVideoStorageProvider();

export type {IVideoStorageProvider, VideoUploadOptions, VideoUploadResult} from './IVideoStorageProvider';
