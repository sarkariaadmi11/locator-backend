import {Prisma} from '@prisma/client';

import {prisma} from '../prisma/client';
import {payoutRequestRepository} from '../repositories/payoutRequestRepository';
import {transactionRepository} from '../repositories/transactionRepository';
import {fcmService} from './fcmService';
import {HttpError} from '../utils/httpError';
import {presentUser} from '../utils/userPresenter';

export const adminService = {
  async getDashboardKpis() {
    const [
      totalUsers,
      activeUsers,
      suspiciousUsers,
      blockedUsers,
      totalTransactions,
      totalRevenue,
      pendingPayouts,
      pendingPayoutAmount,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({where: {isActive: true}}),
      prisma.user.count({where: {isSuspicious: true}}),
      prisma.user.count({where: {isActive: false}}),
      transactionRepository.count({status: 'SUCCESS'}),
      transactionRepository.aggregateSum({status: 'SUCCESS', type: 'CREDIT'}),
      payoutRequestRepository.count({status: 'PENDING'}),
      payoutRequestRepository.aggregateSum({status: 'PENDING'}),
    ]);

    return {
      totalUsers,
      activeUsers,
      suspiciousUsers,
      blockedUsers,
      totalTransactions,
      totalRevenue: Number(totalRevenue._sum.amount ?? 0),
      pendingPayouts,
      pendingPayoutAmount: Number(pendingPayoutAmount._sum.amount ?? 0),
    };
  },

  async listUsers(page: number, limit: number, search?: string, filter?: string) {
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        {name: {contains: search, mode: 'insensitive'}},
        {email: {contains: search, mode: 'insensitive'}},
        {username: {contains: search, mode: 'insensitive'}},
      ];
    }
    if (filter === 'blocked') where.isActive = false;
    if (filter === 'suspicious') where.isSuspicious = true;
    if (filter === 'active') where.isActive = true;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: {createdAt: 'desc'},
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          profileImage: true,
          city: true,
          walletBalance: true,
          isActive: true,
          isSuspicious: true,
          createdAt: true,
        },
      }),
      prisma.user.count({where}),
    ]);

    return {
      users: users.map(u => ({...u, walletBalance: Number(u.walletBalance), createdAt: u.createdAt.toISOString()})),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async toggleBlock(userId: string) {
    const user = await prisma.user.findUnique({where: {id: userId}});
    if (!user) throw new HttpError(404, 'User not found.');

    const updated = await prisma.user.update({
      where: {id: userId},
      data: {isActive: !user.isActive},
    });
    return presentUser(updated);
  },

  async toggleSuspicious(userId: string) {
    const user = await prisma.user.findUnique({where: {id: userId}});
    if (!user) throw new HttpError(404, 'User not found.');

    const updated = await prisma.user.update({
      where: {id: userId},
      data: {isSuspicious: !user.isSuspicious},
    });
    return presentUser(updated);
  },

  async listTransactions(page: number, limit: number, userId?: string, type?: string, status?: string) {
    const skip = (page - 1) * limit;

    const where: Prisma.TransactionWhereInput = {};
    if (userId) where.userId = userId;
    if (type) where.type = type as Prisma.TransactionWhereInput['type'];
    if (status) where.status = status as Prisma.TransactionWhereInput['status'];

    const [transactions, total] = await Promise.all([
      transactionRepository.findMany({
        where,
        skip,
        take: limit,
        orderBy: {createdAt: 'desc'},
        include: {
          user: {select: {id: true, name: true, email: true, username: true}},
        },
      }),
      transactionRepository.count(where),
    ]);

    return {
      transactions: transactions.map(t => ({
        ...t,
        amount: Number(t.amount),
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async exportTransactionsCsv() {
    const transactions = await transactionRepository.findAllForExport();

    const header = 'ID,User Name,User Email,Type,Amount,Status,Description,Created At\n';
    const rows = transactions.map(t =>
      [
        t.id,
        `"${t.user.name}"`,
        t.user.email,
        t.type,
        Number(t.amount).toFixed(2),
        t.status,
        `"${t.description ?? ''}"`,
        t.createdAt.toISOString(),
      ].join(','),
    );

    return header + rows.join('\n');
  },

  async listPayouts(page: number, limit: number, status?: string) {
    const skip = (page - 1) * limit;
    const where: Prisma.PayoutRequestWhereInput = {};
    if (status) where.status = status as Prisma.PayoutRequestWhereInput['status'];

    const [payouts, total] = await Promise.all([
      payoutRequestRepository.findMany({
        where,
        skip,
        take: limit,
        orderBy: {createdAt: 'desc'},
        include: {user: {select: {id: true, name: true, email: true, username: true, walletBalance: true}}},
      }),
      payoutRequestRepository.count(where),
    ]);

    return {
      payouts: payouts.map(p => ({
        ...p,
        amount: Number(p.amount),
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        processedAt: p.processedAt?.toISOString() ?? null,
        user: {...p.user, walletBalance: Number(p.user.walletBalance)},
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async processPayout(payoutId: string, action: 'approve' | 'reject', adminNote?: string) {
    const payout = await payoutRequestRepository.findById(payoutId);

    if (!payout) throw new HttpError(404, 'Payout request not found.');
    if (payout.status !== 'PENDING') throw new HttpError(400, 'Payout request is not pending.');

    const amount = Number(payout.amount).toFixed(2);

    if (action === 'approve') {
      if (Number(payout.user.walletBalance) < Number(payout.amount)) {
        throw new HttpError(400, 'User has insufficient wallet balance.');
      }

      await transactionRepository.runTransaction([
        prisma.payoutRequest.update({
          where: {id: payoutId},
          data: {status: 'APPROVED', adminNote, processedAt: new Date()},
        }),
        prisma.transaction.create({
          data: {
            userId: payout.userId,
            type: 'DEBIT',
            amount: payout.amount,
            status: 'SUCCESS',
            description: 'Payout withdrawal approved by admin',
          },
        }),
        prisma.user.update({
          where: {id: payout.userId},
          data: {walletBalance: {decrement: payout.amount}},
        }),
      ]);

      await fcmService.sendToUser(payout.userId, {
        title: 'Withdrawal Approved ✓',
        body: `Your withdrawal of ₹${amount} has been approved and deducted from your wallet.`,
        data: {type: 'PAYOUT_APPROVED', payoutId, amount},
      });
    } else {
      await payoutRequestRepository.update(payoutId, {status: 'REJECTED', adminNote, processedAt: new Date()});

      await fcmService.sendToUser(payout.userId, {
        title: 'Withdrawal Rejected',
        body: adminNote
          ? `Your withdrawal of ₹${amount} was rejected: ${adminNote}`
          : `Your withdrawal of ₹${amount} was rejected by admin.`,
        data: {type: 'PAYOUT_REJECTED', payoutId, amount},
      });
    }

    return {id: payoutId, action};
  },
};
