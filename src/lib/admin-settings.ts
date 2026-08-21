import { prisma } from '@/lib/prisma';
import { storageHealthcheck } from '@/lib/document-storage';
import { getDocumentGenerationEngine } from '@/lib/document-generation';
import { getEmailProvider } from '@/lib/notification-delivery';
import { sanctionsSourceHealth } from '@/lib/sanctions/source-health';

export type SafeIntegrationStatus = {
  name: string;
  status: 'Ready' | 'Configured' | 'Not configured' | 'Degraded' | 'Unavailable';
  provider?: string;
  mode?: string;
  detail?: string;
  lastSuccessfulRefresh?: string;
};

const configured = (env: NodeJS.ProcessEnv, ...keys: string[]) => keys.every((key) => Boolean(env[key]?.trim()));

/** Safe metadata only. Raw environment values never leave this module. */
export async function adminIntegrationStatuses(env: NodeJS.ProcessEnv = process.env): Promise<SafeIntegrationStatus[]> {
  const statuses: SafeIntegrationStatus[] = [];
  try {
    await prisma.$queryRaw`SELECT 1`;
    statuses.push({ name: 'PostgreSQL', status: 'Ready', provider: 'PostgreSQL' });
  } catch {
    statuses.push({ name: 'PostgreSQL', status: 'Unavailable', provider: 'PostgreSQL' });
  }

  try {
    const storage = await storageHealthcheck();
    statuses.push({ name: 'Object storage', status: storage.ready ? 'Ready' : 'Unavailable', provider: storage.backend });
  } catch {
    statuses.push({ name: 'Object storage', status: 'Unavailable', provider: env.STORAGE_BACKEND ?? 'local' });
  }

  const emailProvider = getEmailProvider(env).name;
  const emailReady = emailProvider === 'resend'
    ? configured(env, 'NOTIFICATION_FROM_EMAIL') && Boolean(env.RESEND_API_KEY?.trim() || env.NOTIFICATION_PROVIDER_API_KEY?.trim())
    : emailProvider === 'http'
      ? configured(env, 'NOTIFICATION_PROVIDER_URL', 'NOTIFICATION_PROVIDER_API_KEY')
      : true;
  statuses.push({
    name: 'Email', status: emailReady ? 'Configured' : 'Not configured', provider: emailProvider,
    mode: env.APP_ENV === 'production' ? 'Live' : 'Sandbox',
    detail: env.NOTIFICATION_FROM_EMAIL?.trim() ? 'Sender identity configured' : 'Sender identity not configured',
  });
  statuses.push({ name: 'Google OAuth', status: configured(env, 'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET') ? 'Configured' : 'Not configured', provider: 'Google' });
  statuses.push({ name: 'Comtrade', status: env.COMTRADE_CLIENT === 'real' && Boolean(env.COMTRADE_API_KEY?.trim()) ? 'Configured' : 'Not configured', provider: env.COMTRADE_CLIENT ?? 'mock' });

  try {
    const health = await sanctionsSourceHealth();
    const last = health.datasets.map((d) => d.last_complete_refresh).filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0];
    statuses.push({ name: 'Sanctions feeds', status: health.global_state === 'READY' ? 'Ready' : health.global_state === 'DEGRADED' ? 'Degraded' : 'Unavailable', provider: 'Configured source set', lastSuccessfulRefresh: last?.toISOString() });
  } catch {
    statuses.push({ name: 'Sanctions feeds', status: 'Unavailable' });
  }

  const scanner = env.DOCUMENT_MALWARE_SCANNER ?? (['production', 'staging'].includes(env.APP_ENV ?? '') ? '' : 'development');
  statuses.push({ name: 'ClamAV scanner', status: scanner === 'http' && env.DOCUMENT_MALWARE_SCANNER_URL?.trim() ? 'Configured' : scanner === 'development' ? 'Configured' : 'Unavailable', provider: scanner || 'none', mode: scanner === 'development' ? 'Development signature' : undefined });

  const cutoff = new Date(Date.now() - Number(env.WORKER_READY_MAX_AGE_MS ?? 60_000));
  const worker = await prisma.workerHeartbeat.findFirst({ where: { last_seen_at: { gte: cutoff } }, orderBy: { last_seen_at: 'desc' }, select: { status: true, last_seen_at: true } }).catch(() => null);
  statuses.push({ name: 'Background worker', status: worker && ['ready', 'busy'].includes(worker.status) ? 'Ready' : worker ? 'Degraded' : 'Not configured', detail: worker ? `Last heartbeat ${worker.last_seen_at.toISOString()}` : undefined });

  try {
    const engine = getDocumentGenerationEngine(env);
    statuses.push({ name: 'Document engine', status: 'Configured', provider: engine.name, detail: `Version ${engine.version}` });
  } catch {
    statuses.push({ name: 'Document engine', status: 'Unavailable' });
  }
  return statuses;
}
