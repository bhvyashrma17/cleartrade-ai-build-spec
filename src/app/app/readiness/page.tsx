import { OrgTier } from '@prisma/client';
import { UpgradeNotice } from '@/components/ui';
import { getPrincipal, requireExporterPrincipal } from '@/lib/auth';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { ReadinessForm } from './ReadinessForm';

export default async function ReadinessPage() {
  const viewer = await getPrincipal();
  if (viewer?.tier === OrgTier.guest) return <div className="mx-auto max-w-3xl p-6"><UpgradeNotice title="Export readiness is available with a free account" requiredTier="free" description="Create a free account to save your readiness answers, receive an assessment and track enablement tasks." /></div>;
  const principal = await requireExporterPrincipal();
  assertCan(principal, 'readiness.run');
  const [current, history, tasks, product] = await Promise.all([
    prisma.readinessAssessment.findFirst({ where: { exporter_org_id: principal.exporter_org_id, is_current: true }, orderBy: { updated_at: 'desc' } }),
    prisma.readinessAssessment.findMany({ where: { exporter_org_id: principal.exporter_org_id, is_current: false }, select: { id: true, score: true, status: true, completed_at: true, created_at: true }, orderBy: { created_at: 'desc' }, take: 10 }),
    prisma.task.findMany({ where: { exporter_org_id: principal.exporter_org_id, task_type: { startsWith: 'readiness_' } }, select: { id: true, title: true, description: true, state: true, owner_role: true, due_at: true, task_type: true }, orderBy: [{ priority: 'desc' }, { due_at: 'asc' }] }),
    prisma.product.findFirst({ where: { exporter_org_id: principal.exporter_org_id }, orderBy: { created_at: 'asc' } }),
  ]);
  return <ReadinessForm product={product ? { id: product.id, lead_time_days: product.lead_time_days, desired_order_size_amount: product.desired_order_size_amount?.toString() ?? null, desired_order_size_currency: product.desired_order_size_currency, customization_capability: product.customization_capability, packaging_capability: product.packaging_capability } : null} current={current ? { answers: current.answers, score: current.score, status: current.status, updated_at: current.updated_at.toISOString(), completed_at: current.completed_at?.toISOString() ?? null } : null} history={history.map((item) => ({ ...item, created_at: item.created_at.toISOString(), completed_at: item.completed_at?.toISOString() ?? null }))} tasks={tasks.map((task) => ({ ...task, due_at: task.due_at?.toISOString() ?? null }))} />;
}
