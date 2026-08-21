import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { CommitmentFeeStatus, OrgTier, UserRole } from '@prisma/client';
import type { Principal } from '../src/types';

let currentPrincipal: Principal;
vi.mock('../src/lib/auth', () => ({ requirePrincipal: vi.fn(async () => currentPrincipal) }));

import { POST as postConfig } from '../src/app/api/v1/config/route';
import { POST as postFeePolicy } from '../src/app/api/v1/fee-policy/route';
import { getConfig } from '../src/lib/config';
import { permits } from '../src/lib/permissions';
import { prisma } from '../src/lib/prisma';

const principal = (id: string, role: UserRole): Principal => ({ id, role, email: `${id}@test.local`, name: role, exporter_org_id: null, tier: OrgTier.paid });
const request = (url: string, body: unknown) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never;

beforeEach(async () => {
  await prisma.auditEvent.deleteMany({ where: { object_type: { in: ['fee_policy', 'config_setting'] } } });
  await prisma.configSetting.deleteMany({ where: { key: 'agent.capacity' } });
  await prisma.feePolicy.deleteMany({});
  const id = `settings-${randomUUID()}`;
  await prisma.user.create({ data: { id, email: `${id}@test.local`, name: 'Settings Admin', role: UserRole.admin } });
  currentPrincipal = principal(id, UserRole.admin);
  await prisma.feePolicy.create({ data: { version: 1, commitment_fee_amount: '1000', commitment_fee_currency: 'INR', commitment_fee_status: CommitmentFeeStatus.not_due, success_fee_rate: '0.10', small_shipment_threshold_amount: '100000', small_shipment_threshold_currency: 'INR', small_shipment_rate: '0.12', small_shipment_flat_amount: '5000', agent_share_rate: '0.40', minimum_shipment_amount: '10000', minimum_shipment_currency: 'INR', is_active: true } });
});

afterAll(async () => { await prisma.$disconnect(); });

describe('admin Settings permissions and configuration', () => {
  test('Settings route exists and the Admin-only nav entry is absent from agent/exporter sets', async () => {
    const [page, shell] = await Promise.all([readFile(path.resolve('src/app/ops/settings/page.tsx'), 'utf8'), readFile(path.resolve('src/components/shell/AppShell.tsx'), 'utf8')]);
    expect(page).toContain('if (!isAdmin(principal))');
    expect(shell).toContain("{ label: 'Settings', href: '/ops/settings', minTier: 'paid', roles: ['admin'] }");
    expect(shell.match(/label: 'Settings'/g)).toHaveLength(1);
  });

  test('role and capability gates refuse agent, exporter, unauthenticated-shaped access, and non-admin config mutation', async () => {
    expect(permits(principal('agent', UserRole.agent), 'config.edit')).toBe(false);
    expect(permits(principal('exporter', UserRole.exporter_owner), 'config.edit')).toBe(false);
    expect(permits(principal('ops', UserRole.ops_supervisor), 'config.edit')).toBe(false);
    currentPrincipal = principal('agent', UserRole.agent);
    const response = await postConfig(request('http://localhost/api/v1/config', { key: 'agent.capacity', value: { target_exporters_per_agent: 12 }, description: 'UAT' }));
    expect(response.status).toBe(403);
  });

  test('agent advisory capacity uses ConfigSetting versioning and remains a display signal', async () => {
    const first = await postConfig(request('http://localhost/api/v1/config', { key: 'agent.capacity', value: { target_exporters_per_agent: 12 }, description: 'First staffing target' }));
    const second = await postConfig(request('http://localhost/api/v1/config', { key: 'agent.capacity', value: { target_exporters_per_agent: 15 }, description: 'Updated staffing target' }));
    expect(first.status).toBe(201); expect(second.status).toBe(201);
    expect(await getConfig('agent.capacity')).toEqual({ target_exporters_per_agent: 15 });
    const rows = await prisma.configSetting.findMany({ where: { key: 'agent.capacity' }, orderBy: { version: 'asc' } });
    expect(rows.map((row) => [row.version, row.is_active])).toEqual([[1, false], [2, true]]);
    const source = await readFile(path.resolve('src/lib/staff-provisioning.ts'), 'utf8');
    expect(source).toContain("getConfig('agent.capacity')");
    expect(source).not.toMatch(/capacityTarget[^\n]*(throw|forbidden|validationError)/);
  });

  test('FeePolicy update creates a new active row, preserves history, and audits the reason', async () => {
    const response = await postFeePolicy(request('http://localhost/api/v1/fee-policy', { commitment_fee_amount: 1200, commitment_fee_currency: 'INR', success_fee_rate: 0.11, small_shipment_threshold_amount: 110000, small_shipment_threshold_currency: 'INR', small_shipment_rate: 0.13, small_shipment_flat_amount: 5500, agent_share_rate: 0.42, minimum_shipment_amount: 12000, minimum_shipment_currency: 'INR', change_reason: 'UAT commercial revision' }));
    expect(response.status).toBe(201);
    const rows = await prisma.feePolicy.findMany({ orderBy: { version: 'asc' } });
    expect(rows.map((row) => [row.version, row.is_active])).toEqual([[1, false], [2, true]]);
    expect(rows[0]!.success_fee_rate.toString()).toBe('0.1');
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { object_type: 'fee_policy', object_id: rows[1]!.id } });
    expect(audit.after_summary).toMatchObject({ version: 2, change_reason: 'UAT commercial revision' });
  });

  test('Settings source exposes no deprecated setting or secret values and Audit has no config mutation forms', async () => {
    const [page, audit] = await Promise.all([readFile(path.resolve('src/app/ops/settings/page.tsx'), 'utf8'), readFile(path.resolve('src/app/ops/audit/page.tsx'), 'utf8')]);
    expect(page).not.toContain('ConfigVersionForm');
    expect(page).not.toContain('RESEND_API_KEY');
    expect(page).not.toContain('AUTH_GOOGLE_SECRET');
    expect(page).not.toContain('DATABASE_URL');
    expect(page).not.toContain('IMPORT_RAW_IDENTITY_ENCRYPTION_KEY');
    expect(page).toContain('deprecated buyers.fit_score_weights setting is not exposed');
    expect(audit).not.toContain('<FeePolicyForm');
    expect(audit).not.toContain('<ConfigVersionForm');
    expect(audit).toContain('Read-only on this page');
  });
});
