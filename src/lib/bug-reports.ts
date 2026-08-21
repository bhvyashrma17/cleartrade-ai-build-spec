import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

export const bugReportSchema = z.object({
  subject: z.string().trim().min(3).max(160),
  what_happened: z.string().trim().min(10).max(10_000),
  expected: z.string().trim().min(3).max(10_000),
  page_url: z.string().trim().url().max(2048).optional().or(z.literal('')),
});

export type BugReportInput = z.infer<typeof bugReportSchema>;

/** Identity, role, environment and correlation are server-owned and cannot be spoofed by input. */
export async function createBugReport(principal: Principal, input: BugReportInput, correlationId: string, db: typeof prisma = prisma) {
  return db.bugReport.create({
    data: {
      reporter_user_id: principal.id,
      reporter_role: principal.role,
      subject: input.subject.trim(),
      what_happened: input.what_happened.trim(),
      expected: input.expected.trim(),
      page_url: input.page_url?.trim() || null,
      app_environment: (process.env.APP_ENV || 'development').slice(0, 32),
      correlation_id: correlationId,
    },
    select: { id: true, correlation_id: true, created_at: true },
  });
}
