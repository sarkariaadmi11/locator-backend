import multer from 'multer';

import {HttpError} from '../utils/httpError';

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: 5 * 1024 * 1024},
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new HttpError(422, 'Only image uploads are allowed.'));
      return;
    }
    cb(null, true);
  },
});

// Dispute Center evidence (PRD §5.14.2, backend Phase 11) — images or PDFs, one file per call.
export const disputeEvidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: 10 * 1024 * 1024},
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/') && file.mimetype !== 'application/pdf') {
      cb(new HttpError(422, 'Evidence must be an image or a PDF.'));
      return;
    }
    cb(null, true);
  },
});

// Recording & Upload pipeline (PRD §5.6, backend Phase 5). 300MB comfortably covers a 15-minute
// (PRD's longest duration option) in-app recording at typical mobile-camera bitrates.
export const REQUEST_VIDEO_MAX_SIZE_BYTES = 300 * 1024 * 1024;
export const REQUEST_VIDEO_ALLOWED_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
];

export const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: REQUEST_VIDEO_MAX_SIZE_BYTES},
  fileFilter: (_req, file, cb) => {
    if (!REQUEST_VIDEO_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(new HttpError(422, `Unsupported video format: ${file.mimetype}.`));
      return;
    }
    cb(null, true);
  },
});
