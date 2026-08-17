import {afterAll,afterEach,beforeAll,describe,expect,test,vi} from 'vitest';
import {JobStatus,UserRole} from '@prisma/client';
import {prisma} from '../src/lib/prisma';
import {renderOperationalEmail,resolveRecipient,ResendEmailProvider,PermanentEmailError,getEmailProvider} from '../src/lib/notification-delivery';
import {runNotificationDelivery} from '../src/lib/job-handlers/notification-delivery';

const marker=`notif-${Date.now()}`;let userId='';
const context=(notification_id:string,attempt_no=1)=>({job_id:`job-${notification_id}`,attempt_no,payload:{notification_id},exporter_org_id:null,target_id:notification_id,correlation_id:marker,reportProgress:async()=>{}});
beforeAll(async()=>{const user=await prisma.user.create({data:{email:`${marker}@example.test`,name:'Notification Test',role:UserRole.ops_supervisor}});userId=user.id;});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
afterAll(async()=>{await prisma.job.deleteMany({where:{correlation_id:{startsWith:'notif_'}}});await prisma.notification.deleteMany({where:{user_id:userId}});await prisma.notificationPreference.deleteMany({where:{user_id:userId}});await prisma.user.delete({where:{id:userId}});await prisma.$disconnect();});
async function notification(type='shipment_milestone',dedupe=crypto.randomUUID()){return prisma.notification.create({data:{user_id:userId,type,title:'Shipment updated',body:'A milestone needs review.',deep_link:'/app/deals/example/shipment',dedupe_key:`${marker}:${dedupe}`}});}

describe('operational notification delivery',()=>{
  test('template rendering is deterministic and contains no provider secret',()=>{const rendered=renderOperationalEmail({title:'Action required',body:'Review the document.',deepLink:'/app/tasks'},{...process.env,NEXT_PUBLIC_APP_URL:'https://pilot.example',NOTIFICATION_PROVIDER_API_KEY:'never-render-this-secret'});expect(rendered).toEqual({subject:'ClearTrade: Action required',text:'Review the document.\n\nOpen ClearTrade: https://pilot.example/app/tasks\n\nYou received this operational notification from ClearTrade.',version:'operational-email-v1'});expect(rendered.text).not.toContain('never-render-this-secret');});
  test('preference suppresses email but keeps the in-app notification',async()=>{await prisma.notificationPreference.create({data:{user_id:userId,category:'shipment_payment',email_enabled:false,in_app_enabled:true}});const n=await notification();const outcome=await runNotificationDelivery(context(n.id));expect(outcome.result).toMatchObject({status:'suppressed'});expect(await prisma.notification.findUnique({where:{id:n.id}})).not.toBeNull();await prisma.notificationPreference.deleteMany({where:{user_id:userId}});});
  test('duplicate events and executions dedupe delivery',async()=>{vi.stubEnv('NOTIFICATION_PROVIDER','sandbox');const n=await notification('document_changes_requested','same-event');await expect(notification('document_changes_requested','same-event')).rejects.toThrow();await runNotificationDelivery(context(n.id));await runNotificationDelivery(context(n.id,2));expect(await prisma.notificationDelivery.count({where:{notification_id:n.id}})).toBe(1);expect((await prisma.notificationDelivery.findFirstOrThrow({where:{notification_id:n.id}})).attempt_count).toBe(1);});
  test('transient failure records retry without leaking credentials',async()=>{vi.stubEnv('NOTIFICATION_PROVIDER','http');vi.stubEnv('NOTIFICATION_PROVIDER_URL','https://provider.invalid/send');vi.stubEnv('NOTIFICATION_PROVIDER_API_KEY','super-secret-provider-key');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:503})));const n=await notification();await expect(runNotificationDelivery(context(n.id,1))).rejects.toThrow(/unavailable/);const row=await prisma.notificationDelivery.findUniqueOrThrow({where:{notification_id_channel:{notification_id:n.id,channel:'email'}}});expect(row).toMatchObject({status:'retrying',attempt_count:1,last_error_code:'PROVIDER_UNAVAILABLE'});expect(JSON.stringify(row)).not.toContain('super-secret-provider-key');});
  test('permanent provider rejection becomes visible final failure',async()=>{vi.stubEnv('NOTIFICATION_PROVIDER','http');vi.stubEnv('NOTIFICATION_PROVIDER_URL','https://provider.invalid/send');vi.stubEnv('NOTIFICATION_PROVIDER_API_KEY','secret');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:422})));const n=await notification();const outcome=await runNotificationDelivery(context(n.id));expect(outcome.result).toMatchObject({status:'rejected'});expect(await prisma.notificationDelivery.findUniqueOrThrow({where:{notification_id_channel:{notification_id:n.id,channel:'email'}}})).toMatchObject({status:'rejected',failed_at:expect.any(Date)});});
  test('database outbox creates exactly one bounded-retry job per notification',async()=>{const n=await notification();const jobs=await prisma.job.findMany({where:{target_type:'notification',target_id:n.id}});expect(jobs).toHaveLength(1);expect(jobs[0]).toMatchObject({type:'notification_delivery',status:JobStatus.queued,max_attempts:3});});
  test('destination references are user-scoped and do not persist email addresses',async()=>{vi.stubEnv('NOTIFICATION_PROVIDER','sandbox');const n=await notification();await runNotificationDelivery(context(n.id));const row=await prisma.notificationDelivery.findUniqueOrThrow({where:{notification_id_channel:{notification_id:n.id,channel:'email'}}});expect(row.destination_reference).toBe(`user:${userId}`);expect(row.destination_reference).not.toContain('@');});
});

// ---------------------------------------------------------------------------
// Phase 6 — Resend adapter + staging recipient guard.
// Contract tests against an injected fetch. NOT evidence that Resend is connected.
// ---------------------------------------------------------------------------

describe('staging recipient guard', () => {
  const stagingEnv = (over: Record<string, string> = {}) => ({ APP_ENV: 'staging', ...over }) as unknown as NodeJS.ProcessEnv;

  test('an allow-listed exact address is delivered untouched', () => {
    const r = resolveRecipient('ops@cleartrade.test', stagingEnv({ NOTIFICATION_ALLOWED_RECIPIENTS: 'ops@cleartrade.test' }));
    expect(r).toEqual({ deliverTo: 'ops@cleartrade.test', redirected: false });
  });

  test('an allow-listed domain suffix is delivered untouched', () => {
    const r = resolveRecipient('anyone@cleartrade.test', stagingEnv({ NOTIFICATION_ALLOWED_RECIPIENTS: '@cleartrade.test' }));
    expect(r.redirected).toBe(false);
  });

  test('a non-allowed address is REDIRECTED when a catch-all is configured', () => {
    const r = resolveRecipient('stranger@example.com', stagingEnv({ NOTIFICATION_ALLOWED_RECIPIENTS: '@cleartrade.test', NOTIFICATION_REDIRECT_TO: 'catchall@cleartrade.test' }));
    expect(r).toEqual({ deliverTo: 'catchall@cleartrade.test', redirected: true });
  });

  test('a non-allowed address with no catch-all is REFUSED, never sent', () => {
    expect(() => resolveRecipient('stranger@example.com', stagingEnv({ NOTIFICATION_ALLOWED_RECIPIENTS: '@cleartrade.test' })))
      .toThrow(/RECIPIENT_NOT_ALLOWED|Refusing to email/);
  });

  test('the refusal is permanent, so it is not retried forever', () => {
    try {
      resolveRecipient('stranger@example.com', stagingEnv({ NOTIFICATION_ALLOWED_RECIPIENTS: '@cleartrade.test' }));
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PermanentEmailError);
    }
  });

  test('the refusal message does not disclose the full address', () => {
    try {
      resolveRecipient('secret.person@example.com', stagingEnv({}));
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('secret.person');
      expect((error as Error).message).toContain('***');
    }
  });

  test('production is unaffected — real users receive their mail', () => {
    const r = resolveRecipient('customer@example.com', { APP_ENV: 'production' } as unknown as NodeJS.ProcessEnv);
    expect(r).toEqual({ deliverTo: 'customer@example.com', redirected: false });
  });

  test('development is unaffected', () => {
    const r = resolveRecipient('dev@example.com', { APP_ENV: 'development' } as unknown as NodeJS.ProcessEnv);
    expect(r.redirected).toBe(false);
  });
});

describe('Resend provider contract', () => {
  const base = {
    APP_ENV: 'staging', RESEND_API_KEY: 'test-key', NOTIFICATION_FROM_EMAIL: 'ops@cleartrade.test',
    NOTIFICATION_ALLOWED_RECIPIENTS: '@cleartrade.test',
  };
  const msg = { to: 'ops@cleartrade.test', subject: 'Task due', text: 'body' };
  const stub = (status: number, body: unknown) => vi.stubGlobal('fetch', (async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch);

  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const applyEnv = (over: Record<string, string> = {}) => { for (const [k, v] of Object.entries({ ...base, ...over })) vi.stubEnv(k, v); };

  test('a successful send returns the provider message id', async () => {
    applyEnv(); stub(200, { id: 're_123' });
    const result = await new ResendEmailProvider().send(msg);
    expect(result.providerMessageId).toBe('re_123');
    // Acceptance is not delivery — that is confirmed by webhook.
    expect(result.delivered).toBe(false);
  });

  test('it posts Resend\'s payload shape, not the internal message shape', async () => {
    applyEnv();
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', (async (_u: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ id: 're_1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch);
    await new ResendEmailProvider().send(msg);
    expect(body.from).toBe('ops@cleartrade.test');
    expect(body.to).toEqual(['ops@cleartrade.test']);
    expect(body.subject).toBe('Task due');
  });

  test('a 4xx is permanent and is not retried', async () => {
    applyEnv(); stub(422, { message: 'invalid from address' });
    await expect(new ResendEmailProvider().send(msg)).rejects.toBeInstanceOf(PermanentEmailError);
  });

  test('a 429 is transient so the job retries with backoff', async () => {
    applyEnv(); stub(429, {});
    const error = await new ResendEmailProvider().send(msg).catch((e) => e);
    expect(error).not.toBeInstanceOf(PermanentEmailError);
    expect(String(error.message)).toMatch(/rate limited/i);
  });

  test('a 5xx is transient', async () => {
    applyEnv(); stub(503, {});
    const error = await new ResendEmailProvider().send(msg).catch((e) => e);
    expect(error).not.toBeInstanceOf(PermanentEmailError);
  });

  test('a transport failure is transient, never a silent drop', async () => {
    applyEnv();
    vi.stubGlobal('fetch', (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch);
    const error = await new ResendEmailProvider().send(msg).catch((e) => e);
    expect(error).not.toBeInstanceOf(PermanentEmailError);
    expect(String(error.message)).toMatch(/unreachable/i);
  });

  test('a response without an id is treated as a failure, not a success', async () => {
    applyEnv(); stub(200, {});
    await expect(new ResendEmailProvider().send(msg)).rejects.toThrow(/omitted the message id/);
  });

  test('a redirected staging message is labelled with the intended recipient', async () => {
    applyEnv({ NOTIFICATION_REDIRECT_TO: 'catchall@cleartrade.test', NOTIFICATION_ALLOWED_RECIPIENTS: '@nobody.test' });
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', (async (_u: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ id: 're_1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch);
    await new ResendEmailProvider().send({ ...msg, to: 'stranger@example.com' });
    expect(body.to).toEqual(['catchall@cleartrade.test']);
    expect(String(body.subject)).toContain('[staging→stranger@example.com]');
  });

  test('getEmailProvider selects Resend only when configured', () => {
    expect(getEmailProvider({ NOTIFICATION_PROVIDER: 'resend' } as unknown as NodeJS.ProcessEnv).name).toBe('resend');
    expect(getEmailProvider({ NOTIFICATION_PROVIDER: 'http' } as unknown as NodeJS.ProcessEnv).name).toBe('http');
    expect(getEmailProvider({} as unknown as NodeJS.ProcessEnv).name).toBe('sandbox');
  });
});
