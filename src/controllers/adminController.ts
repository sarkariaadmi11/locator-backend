import {RequestStatus} from '@prisma/client';
import {Request, Response} from 'express';
import {z} from 'zod';

import {AdminRequest} from '../middlewares/adminAuthMiddleware';
import {adminAuthService} from '../services/adminAuthService';
import {adminService} from '../services/adminService';
import {walletService} from '../services/walletService';
import {prisma} from '../prisma/client';
import {sendSuccess} from '../utils/apiResponse';

export const adminController = {
  async login(req: Request, res: Response) {
    const {email, password} = req.body;
    const data = await adminAuthService.login(email, password);
    sendSuccess(res, 200, 'Login successful.', data);
  },

  async me(req: AdminRequest, res: Response) {
    const {id, email, name} = req.admin!;
    sendSuccess(res, 200, 'Admin fetched.', {id, email, name});
  },

  async getDashboard(_req: Request, res: Response) {
    const data = await adminService.getDashboardKpis();
    sendSuccess(res, 200, 'Dashboard KPIs fetched.', data);
  },

  async getLiveMonitoring(_req: Request, res: Response) {
    const data = await adminService.getLiveMonitoring();
    sendSuccess(res, 200, 'Live monitoring snapshot fetched.', data);
  },

  async getActiveRequests(req: Request, res: Response) {
    const {page, limit, status} = req.query as unknown as {
      page: number;
      limit: number;
      status?: RequestStatus;
    };
    const data = await adminService.getActiveRequests(status, page, limit);
    sendSuccess(res, 200, 'Active requests fetched.', data);
  },

  async listUsers(req: Request, res: Response) {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const filter = typeof req.query.filter === 'string' ? req.query.filter : undefined;
    const data = await adminService.listUsers(page, limit, search, filter);
    sendSuccess(res, 200, 'Users fetched.', data);
  },

  async toggleBlock(req: AdminRequest, res: Response) {
    const data = await adminService.toggleBlock(req.admin!.id, req.params.id as string);
    sendSuccess(res, 200, 'User block status updated.', data);
  },

  async toggleSuspicious(req: AdminRequest, res: Response) {
    const data = await adminService.toggleSuspicious(req.admin!.id, req.params.id as string);
    sendSuccess(res, 200, 'User suspicious status updated.', data);
  },

  async listTransactions(req: Request, res: Response) {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const userId = req.query.userId as string | undefined;
    const type = req.query.type as string | undefined;
    const status = req.query.status as string | undefined;
    const data = await adminService.listTransactions(page, limit, userId, type, status);
    sendSuccess(res, 200, 'Transactions fetched.', data);
  },

  async exportTransactions(_req: Request, res: Response) {
    const csv = await adminService.exportTransactionsCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.status(200).send(csv);
  },

  async listPayouts(req: Request, res: Response) {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const status = req.query.status as string | undefined;
    const data = await adminService.listPayouts(page, limit, status);
    sendSuccess(res, 200, 'Payout requests fetched.', data);
  },

  async processPayout(req: AdminRequest, res: Response) {
    const {action, adminNote} = req.body;
    const data = await adminService.processPayout(req.admin!.id, req.params.id as string, action, adminNote);
    sendSuccess(res, 200, `Payout ${action}d.`, data);
  },

  async reconcilePendingTransactions(_req: Request, res: Response) {
    const data = await walletService.reconcileStalePendingTransactions();
    sendSuccess(res, 200, 'Pending transactions reconciled.', data);
  },

  async registerFcmToken(req: AdminRequest, res: Response) {
    const {fcmToken} = z.object({fcmToken: z.string().min(1)}).parse(req.body);
    await prisma.admin.update({where: {id: req.admin!.id}, data: {fcmToken}});
    sendSuccess(res, 200, 'FCM token registered.', null);
  },
};
