import {Response} from 'express';

import {AuthenticatedRequest} from '../middlewares/authMiddleware';
import {recordingService} from '../services/recordingService';
import {sendSuccess} from '../utils/apiResponse';

export const recordingController = {
  async start(req: AuthenticatedRequest, res: Response) {
    const data = await recordingService.startRecording(req.user!.id, req.params.id as string);
    sendSuccess(res, 200, 'Recording started.', data);
  },

  async createSession(req: AuthenticatedRequest, res: Response) {
    const data = await recordingService.createUploadSession(req.user!.id, req.params.id as string);
    sendSuccess(res, 201, 'Upload session created.', data);
  },

  async completeUpload(req: AuthenticatedRequest, res: Response) {
    const {gpsLatitude, gpsLongitude, recordedAt, durationSeconds} = req.body as {
      gpsLatitude: number;
      gpsLongitude: number;
      recordedAt: Date;
      durationSeconds: number;
    };
    const data = await recordingService.completeUpload(
      req.user!.id,
      req.params.id as string,
      req.params.videoId as string,
      req.file,
      {gpsLatitude, gpsLongitude, recordedAt, durationSeconds},
    );
    sendSuccess(res, 200, 'Video uploaded.', data);
  },

  async retryUpload(req: AuthenticatedRequest, res: Response) {
    const data = await recordingService.retryUpload(req.user!.id, req.params.id as string, req.params.videoId as string);
    sendSuccess(res, 200, 'Upload session reset for retry.', data);
  },

  async cancelUpload(req: AuthenticatedRequest, res: Response) {
    const data = await recordingService.cancelUpload(req.user!.id, req.params.id as string, req.params.videoId as string);
    sendSuccess(res, 200, 'Upload session cancelled.', data);
  },

  async getVideo(req: AuthenticatedRequest, res: Response) {
    const data = await recordingService.getVideo(req.user!.id, req.params.id as string);
    sendSuccess(res, 200, 'Video fetched.', data);
  },

  async getVideoHistory(req: AuthenticatedRequest, res: Response) {
    const data = await recordingService.getVideoHistory(req.user!.id, req.params.id as string);
    sendSuccess(res, 200, 'Video history fetched.', data);
  },

  async deleteDraft(req: AuthenticatedRequest, res: Response) {
    const data = await recordingService.deleteDraft(req.user!.id, req.params.id as string, req.params.videoId as string);
    sendSuccess(res, 200, 'Draft video deleted.', data);
  },
};
