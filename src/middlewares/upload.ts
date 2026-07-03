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
