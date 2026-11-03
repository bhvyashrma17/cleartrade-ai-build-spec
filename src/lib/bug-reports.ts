import { UserRole } from '@prisma/client';
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

/** Staff who are told about every new report (R-40): they triage it from `/ops/support`. */
export const BUG_REPORT_TRIAGE_ROLES = [UserRole.admin, UserRole.ops_supervisor] as const;

/**
 * Identity, role, environment and correlation are server-owned and cannot be spoofed by input.
 * The report and one in-app notification per active triage user are written together, so a report
 * is never stored without anyone being told (R-40).
 */
export async function createBugReport(principal: Principal, input: BugReportInput, correlationId: string, db: typeof prisma = prisma) {
  return db.$transaction(async (tx) => {
    const report = await tx.bugReport.create({
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
      select: { id: true, correlation_id: true, created_at: true, subject: true },
    });
    const staff = await tx.user.findMany({
      where: { role: { in: [...BUG_REPORT_TRIAGE_ROLES] }, is_active: true, id: { not: principal.id } },
      select: { id: true },
    });
    if (staff.length > 0) {
      await tx.notification.createMany({
        data: staff.map((user) => ({
          user_id: user.id,
          type: 'bug_report',
          title: 'New bug report',
          body: report.subject.slice(0, 140),
          severity: 'warning' as const,
          object_type: 'bug_report',
          object_id: report.id,
          deep_link: '/ops/support',
          dedupe_key: `bug_report:${report.id}`,
        })),
        skipDuplicates: true,
      });
    }
    return { id: report.id, correlation_id: report.correlation_id, created_at: report.created_at };
  });
}

/** The newest reports first, with who sent them, for `/ops/support`. */
export async function listBugReports(limit = 100, db: typeof prisma = prisma) {
  return db.bugReport.findMany({
    orderBy: { created_at: 'desc' },
    take: Math.min(Math.max(limit, 1), 500),
    select: {
      id: true, subject: true, what_happened: true, expected: true, page_url: true, app_environment: true,
      reporter_role: true, correlation_id: true, created_at: true,
      reporter: { select: { name: true, email: true } },
    },
  });
}
