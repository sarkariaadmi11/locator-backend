import {z} from 'zod';

export const sendChatMessageSchema = z.object({
  body: z.string().trim().min(1, 'Message cannot be empty.').max(1000, 'Message must be at most 1000 characters.'),
});
