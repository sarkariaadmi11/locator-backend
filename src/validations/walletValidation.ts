import {z} from 'zod';

export const createOrderSchema = z.object({
  amount: z.number().positive().min(1).max(100000),
});

export const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

export const withdrawSchema = z.object({
  amount: z.number().positive().min(1).max(100000),
});
