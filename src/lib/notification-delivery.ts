import {createHash} from 'node:crypto';
import {categoryForType,isDisableableCategory} from '@/lib/notifications';
import {prisma} from '@/lib/prisma';

export interface EmailMessage {to:string;subject:string;text:string;}
export interface EmailDeliveryResult {providerMessageId:string;delivered:boolean;}
export interface EmailProvider {readonly name:string;send(message:EmailMessage):Promise<EmailDeliveryResult>;}
export class PermanentEmailError extends Error {constructor(readonly code:string,message:string){super(message);}}

export class SandboxEmailProvider implements EmailProvider {
  readonly name='sandbox';
  async send(message:EmailMessage){return {providerMessageId:`sandbox_${createHash('sha256').update(`${message.to}|${message.subject}|${message.text}`).digest('hex').slice(0,24)}`,delivered:true};}
}
export class HttpEmailProvider implements EmailProvider {
  readonly name='http';
  async send(message:EmailMessage){const url=process.env.NOTIFICATION_PROVIDER_URL,key=process.env.NOTIFICATION_PROVIDER_API_KEY;if(!url||!key)throw new Error('Email provider is not configured.');const response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(message),signal:AbortSignal.timeout(15000)});if(response.status>=400&&response.status<500)throw new PermanentEmailError('PROVIDER_REJECTED',`Provider rejected message (${response.status}).`);if(!response.ok)throw new Error(`Email provider unavailable (${response.status}).`);const body=await response.json() as {id?:string;delivered?:boolean};if(!body.id)throw new Error('Email provider response omitted message ID.');return {providerMessageId:body.id,delivered:body.delivered===true};}
}
/**
 * Staging recipient guard.
 *
 * A staging environment holding realistic data can email real people by accident — a seeded
 * address, a copied row, a colleague's account. That is not a theoretical risk, it is the
 * normal failure mode of a staging mail integration, and it is not undoable once sent.
 *
 * Two independent controls, evaluated in order:
 *   1. `NOTIFICATION_ALLOWED_RECIPIENTS` — comma-separated addresses and/or `@domain`
 *      suffixes. Anything not matching is not delivered.
 *   2. `NOTIFICATION_REDIRECT_TO` — if set, a non-allowed recipient is REDIRECTED here
 *      rather than dropped, so the message is still observable during testing.
 *
 * With neither set in a real environment, delivery to an unlisted address is refused
 * permanently rather than sent. Fail-closed: the safe outcome is "no email", never
 * "email to a stranger".
 */
export function resolveRecipient(to:string,env:NodeJS.ProcessEnv=process.env):{deliverTo:string;redirected:boolean}{
  const real=['production','staging'].includes(env.APP_ENV??'');
  const allowRaw=env.NOTIFICATION_ALLOWED_RECIPIENTS?.trim();
  // Production sends to real users; the guard exists for non-production real environments.
  if(!real||env.APP_ENV==='production')return {deliverTo:to,redirected:false};

  const address=to.trim().toLowerCase();
  const allowed=(allowRaw??'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  const permitted=allowed.some(rule=>rule.startsWith('@')?address.endsWith(rule):address===rule);
  if(permitted)return {deliverTo:to,redirected:false};

  const redirect=env.NOTIFICATION_REDIRECT_TO?.trim();
  if(redirect)return {deliverTo:redirect,redirected:true};
  throw new PermanentEmailError('RECIPIENT_NOT_ALLOWED',
    `Refusing to email ${address.replace(/^[^@]+/,'***')} from ${env.APP_ENV}: not in NOTIFICATION_ALLOWED_RECIPIENTS and no NOTIFICATION_REDIRECT_TO is configured.`);
}

/**
 * Resend transactional email (operational messages only).
 *
 * Deliberately NOT used for buyer outreach — outreach has different consent, deliverability
 * and audit requirements, and routing it through the operational sender would put compliance
 * mail and cold contact on the same domain reputation.
 *
 * Error mapping matches the retry contract in job-handlers/notification-delivery.ts:
 *   4xx (except 429) -> PermanentEmailError, terminal, no retry
 *   429 / 5xx / transport -> ordinary Error, retried with backoff
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name='resend';
  async send(message:EmailMessage){
    const key=process.env.RESEND_API_KEY??process.env.NOTIFICATION_PROVIDER_API_KEY;
    const from=process.env.NOTIFICATION_FROM_EMAIL;
    if(!key)throw new Error('RESEND_API_KEY is not configured.');
    if(!from)throw new Error('NOTIFICATION_FROM_EMAIL is not configured (must be a verified Resend sender).');

    const {deliverTo,redirected}=resolveRecipient(message.to);
    const url=process.env.NOTIFICATION_PROVIDER_URL??'https://api.resend.com/emails';
    const subject=redirected?`[staging→${message.to}] ${message.subject}`:message.subject;

    let response:Response;
    try{
      response=await fetch(url,{
        method:'POST',
        headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},
        body:JSON.stringify({from,to:[deliverTo],subject,text:message.text}),
        signal:AbortSignal.timeout(15000),
      });
    }catch(error){
      // Transport failure is transient by assumption — retried, never silently dropped.
      throw new Error(`Resend unreachable: ${error instanceof Error?error.message:String(error)}`);
    }

    if(response.status===429)throw new Error('Resend rate limited (429).');
    if(response.status>=400&&response.status<500){
      const detail=await response.text().catch(()=>'');
      // A malformed address or unverified sender will never succeed on retry.
      throw new PermanentEmailError('PROVIDER_REJECTED',`Resend rejected message (${response.status}). ${detail.slice(0,200)}`);
    }
    if(!response.ok)throw new Error(`Resend unavailable (${response.status}).`);

    const body=await response.json().catch(()=>({})) as {id?:string};
    if(!body.id)throw new Error('Resend response omitted the message id.');
    // Resend accepts for delivery; final delivery is confirmed by webhook, not by this call.
    return {providerMessageId:body.id,delivered:false};
  }
}

export function getEmailProvider(env:NodeJS.ProcessEnv=process.env):EmailProvider {
  if(env.NOTIFICATION_PROVIDER==='resend')return new ResendEmailProvider();
  return env.NOTIFICATION_PROVIDER==='http'?new HttpEmailProvider():new SandboxEmailProvider();
}

const TEMPLATE_VERSION='operational-email-v1';
export function renderOperationalEmail(input:{title:string;body:string;deepLink:string|null},env:NodeJS.ProcessEnv=process.env):{subject:string;text:string;version:string}{const base=(env.NEXT_PUBLIC_APP_URL??'http://localhost:3000').replace(/\/$/,'');const link=input.deepLink?`${base}${input.deepLink.startsWith('/')?'':'/'}${input.deepLink}`:null;return {subject:`ClearTrade: ${input.title}`,text:[input.body,link?`Open ClearTrade: ${link}`:null,'You received this operational notification from ClearTrade.'].filter(Boolean).join('\n\n'),version:TEMPLATE_VERSION};}

export async function emailEnabled(userId:string,type:string){const category=categoryForType(type);if(!isDisableableCategory(category))return true;const preference=await prisma.notificationPreference.findUnique({where:{user_id_category:{user_id:userId,category}}});return preference?.email_enabled??true;}
