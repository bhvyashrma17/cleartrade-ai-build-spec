import {createHash} from 'node:crypto';
import {appEnvironment,isRealWorkflowEnvironment,type ClearTradeEnvironment} from '@/lib/evidence-environment';

export type RuntimeRole='web'|'worker'|'migration'|'scheduler';
const missing=(env:NodeJS.ProcessEnv,name:string)=>!env[name]?.trim();

export function databaseIdentityFingerprint(env: NodeJS.ProcessEnv) {
  return createHash('sha256').update(env.DATABASE_URL?.trim() ?? '').digest('hex');
}

export function storageIdentityFingerprint(env: NodeJS.ProcessEnv) {
  return createHash('sha256').update(JSON.stringify([
    env.STORAGE_ENDPOINT?.trim() ?? '', env.STORAGE_BUCKET?.trim() ?? '', env.AWS_ACCESS_KEY_ID?.trim() ?? '',
  ])).digest('hex');
}

/**
 * Values that must never reach a real environment.
 *
 * These are the placeholders committed to `.env.example` / `.env.staging.example`. They are
 * public by definition, so treating them as forbidden costs nothing and catches the single
 * most common deployment mistake: shipping the example file's value.
 *
 * LIMITATION, stated plainly: this cannot detect reuse of a *genuinely random* development
 * secret in staging, because the process has no knowledge of the development value. That
 * separation is enforced by provisioning discipline (generate staging secrets independently;
 * see docs/26) and by rotation ownership in the configuration inventory — not by this check.
 */
const FORBIDDEN_SECRET_VALUES=new Set(['REPLACE_WITH_SECRET_MANAGER_VALUE','changeme','change-me','secret','password','development','dev','staging','test','example','placeholder','todo']);

/** Reject a placeholder, a repeated-character filler, or anything below the length floor. */
function weakSecret(value:string|undefined,minLength:number):string|null{
  const v=value?.trim()??'';
  if(v.length<minLength)return `must be at least ${minLength} characters`;
  if(FORBIDDEN_SECRET_VALUES.has(v)||FORBIDDEN_SECRET_VALUES.has(v.toLowerCase()))return 'is a known placeholder value';
  if(/^(.)\1+$/.test(v))return 'is a single repeated character';
  if(new Set(v).size<8)return 'has too few distinct characters to be randomly generated';
  return null;
}

/**
 * The raw-identity key must decode to exactly 32 bytes of AES-256 key material.
 *
 * `import-identity.ts` falls back to `sha256(value)` when the input does not decode to 32
 * bytes. That fallback keeps development ergonomic, but it also means a weak string silently
 * becomes a "valid" key. In a real environment that is a fail-open, so the strong form is
 * required here instead of being left to the consumer.
 */
function rawIdentityKeyProblem(value:string|undefined):string|null{
  const v=value?.trim();
  if(!v)return 'is required';
  if(FORBIDDEN_SECRET_VALUES.has(v))return 'is a known placeholder value';
  const decoded=Buffer.from(v,'base64');
  if(decoded.length!==32)return 'must be exactly 32 bytes of base64-encoded key material (openssl rand -base64 32)';
  return null;
}

/** Previous-key maps are rotation state; malformed JSON must fail at startup, not at first decrypt. */
function previousKeyMapProblem(raw:string|undefined,minLength:number):string|null{
  if(!raw?.trim())return null;
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{return 'must be a JSON object keyed by version';}
  if(typeof parsed!=='object'||parsed===null||Array.isArray(parsed))return 'must be a JSON object keyed by version';
  for(const [version,secret] of Object.entries(parsed as Record<string,unknown>)){
    if(!version.trim())return 'contains an entry with an empty version key';
    if(typeof secret!=='string'||secret.trim().length<minLength)return `entry "${version}" must be a string of at least ${minLength} characters`;
  }
  return null;
}

function oauthProviderPairProblem(
  env: NodeJS.ProcessEnv,
  idKey: string,
  secretKey: string,
  providerLabel: string,
): string | null {
  const hasId = !missing(env, idKey);
  const hasSecret = !missing(env, secretKey);
  if (!hasId && !hasSecret) return null;
  if (hasId && hasSecret) return null;
  return `${providerLabel} OAuth requires both ${idKey} and ${secretKey} when enabled.`;
}

/**
 * The payment gateway is all-or-nothing, and partial configuration must fail at BOOT.
 *
 * `isRazorpayConfigured()` already treats a missing variable as "payments are off", which is
 * the right runtime behaviour but the wrong deployment behaviour: a production deploy that
 * silently disables checkout because one of five variables was mistyped looks healthy on
 * every health check while taking no money at all. Worse is the inverse — keys present,
 * webhook secret absent — where checkouts start, cards are charged, and no confirmation can
 * ever be verified, so memberships never activate and the money has to be refunded by hand.
 *
 * Returns one message per problem so the operator fixes everything in one pass.
 */
const RAZORPAY_VARS=['RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET','RAZORPAY_PLAN_ID_MONTHLY','RAZORPAY_PLAN_ID_ANNUAL'] as const;

function razorpayProblems(env:NodeJS.ProcessEnv,environment:ClearTradeEnvironment):string[]{
  const problems:string[]=[];
  const present=RAZORPAY_VARS.filter(name=>!missing(env,name));
  if(present.length===0){
    // Unconfigured is legal everywhere EXCEPT production. cleartrade.in with payments off
    // is a storefront with no till: every Upgrade button renders disabled, which is a
    // silent revenue outage rather than an error anyone would be paged for.
    //
    // BUT this must not become a deploy landmine on a site that is already serving. A
    // production instance that boots today without payment credentials would start failing
    // its healthcheck the moment this check shipped, taking the live site down over a
    // feature that is not yet switched on. So the escape hatch is explicit and deliberate,
    // following the `DANGEROUS_ALLOW_PRODUCTION_FIXTURES` precedent in this file: an
    // operator states "we are not selling yet" in one variable, and the plans page renders
    // its honest "card payments are not available" state instead of the app refusing to
    // start. What is NOT possible is arriving in that state by forgetting something.
    if(environment==='production'&&env.PAYMENTS_DISABLED?.trim()!=='true'){
      problems.push(`Payments are not configured. ${RAZORPAY_VARS.join(', ')} are required in production — set them as Railway Variables, never in a file in the image. To run production deliberately without payments, set PAYMENTS_DISABLED=true.`);
    }
    return problems;
  }

  // Both at once is contradictory, and the ambiguity is dangerous in the direction that
  // costs money: it is not knowable whether the operator meant "stop selling" or "start".
  if(env.PAYMENTS_DISABLED?.trim()==='true')problems.push('PAYMENTS_DISABLED=true is set while Razorpay credentials are also configured. Remove one — leaving both is ambiguous about whether memberships should be on sale.');
  const absent=RAZORPAY_VARS.filter(name=>missing(env,name));
  if(absent.length>0)problems.push(`Razorpay is partially configured — ${absent.join(', ')} ${absent.length===1?'is':'are'} missing. All five are required together, or none.`);

  const keyId=env.RAZORPAY_KEY_ID?.trim()??'';
  // Test keys in production take no money; live keys outside production take REAL money
  // from a real card. Both are caught here rather than discovered by a customer.
  if(environment==='production'&&keyId.startsWith('rzp_test_'))problems.push('RAZORPAY_KEY_ID is a TEST key in production — no real payment can succeed. Use the live key from the Razorpay dashboard.');
  if(environment!=='production'&&keyId.startsWith('rzp_live_'))problems.push(`RAZORPAY_KEY_ID is a LIVE key in ${environment} — this would charge real cards. Live keys belong only in the production Railway service.`);

  for(const name of ['RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'] as const){
    const value=env[name]?.trim();
    if(value&&FORBIDDEN_SECRET_VALUES.has(value))problems.push(`${name} is a known placeholder value.`);
  }
  // The two plans must be distinct objects; the same id on both means whichever the member
  // picked, they are billed on one cadence — a billing bug that only surfaces on renewal.
  const monthly=env.RAZORPAY_PLAN_ID_MONTHLY?.trim(),annual=env.RAZORPAY_PLAN_ID_ANNUAL?.trim();
  if(monthly&&annual&&monthly===annual)problems.push('RAZORPAY_PLAN_ID_MONTHLY and RAZORPAY_PLAN_ID_ANNUAL are the same id; they must be two distinct Razorpay plans.');
  return problems;
}

export function validateRuntimeEnvironment(role:RuntimeRole,env:NodeJS.ProcessEnv=process.env){
  const environment=appEnvironment(env),errors:string[]=[];
  if(missing(env,'DATABASE_URL'))errors.push('DATABASE_URL is required.');
  if(isRealWorkflowEnvironment(env)){
    if(env.DATABASE_ENVIRONMENT!==environment)errors.push(`DATABASE_ENVIRONMENT must equal ${environment}.`);
    if(/(?:test|dev|local)/i.test(env.DATABASE_URL??''))errors.push(`${environment} cannot use a database URL labelled test/dev/local.`);
    // Transport encryption. A managed provider that terminates TLS still requires the client
    // to ask for it; without sslmode the driver may silently negotiate plaintext.
    if(!/sslmode=(require|verify-ca|verify-full)/i.test(env.DATABASE_URL??''))errors.push('DATABASE_URL must request TLS (sslmode=require or stricter).');
    // Migrations run over a direct (unpooled) connection. Optional, but if present it must be
    // held to the same standards as the pooled URL — a dev database here would be worse, not
    // better, since the migrator writes schema.
    if(env.DIRECT_DATABASE_URL?.trim()){
      if(/(?:test|dev|local)/i.test(env.DIRECT_DATABASE_URL))errors.push(`${environment} cannot use a direct database URL labelled test/dev/local.`);
      if(!/sslmode=(require|verify-ca|verify-full)/i.test(env.DIRECT_DATABASE_URL))errors.push('DIRECT_DATABASE_URL must request TLS (sslmode=require or stricter).');
    }else if(role==='migration')errors.push('DIRECT_DATABASE_URL is required for the migration role (unpooled connection).');

    // DATABASE_ENVIRONMENT is operator-supplied and cannot detect a copied production URL. A
    // staging deployment therefore pins the exact resolved resource identity. Copying another
    // environment's URL or rotating credentials without deliberately updating the pin fails boot.
    if(environment==='staging'){
      if(missing(env,'DATABASE_IDENTITY_SHA256'))errors.push('DATABASE_IDENTITY_SHA256 is required in staging.');
      else if(env.DATABASE_IDENTITY_SHA256!==databaseIdentityFingerprint(env))errors.push('DATABASE_URL does not match the pinned staging database identity.');
    }

    for(const [name,min] of [['AUTH_SECRET',32],['GUEST_IP_HASH_SECRET',32],['IMPORT_BUYER_REF_SECRET',32],['OPERATIONS_TOKEN',32]] as const){
      const problem=weakSecret(env[name],min);
      if(problem)errors.push(`${name} ${problem}.`);
    }
    const rawKey=rawIdentityKeyProblem(env.IMPORT_RAW_IDENTITY_ENCRYPTION_KEY);
    if(rawKey)errors.push(`IMPORT_RAW_IDENTITY_ENCRYPTION_KEY ${rawKey}.`);

    // Key versions must be explicit in a real environment. Defaulting to 'v1' is fine in
    // development, but an unlabelled key cannot be rotated without ambiguity later.
    for(const name of ['IMPORT_BUYER_REF_KEY_VERSION','IMPORT_RAW_IDENTITY_KEY_VERSION'] as const)
      if(missing(env,name))errors.push(`${name} is required so key material can be rotated unambiguously.`);
    const prevRef=previousKeyMapProblem(env.IMPORT_BUYER_REF_PREVIOUS_SECRETS,32);
    if(prevRef)errors.push(`IMPORT_BUYER_REF_PREVIOUS_SECRETS ${prevRef}.`);
    const prevRaw=previousKeyMapProblem(env.IMPORT_RAW_IDENTITY_PREVIOUS_KEYS,32);
    if(prevRaw)errors.push(`IMPORT_RAW_IDENTITY_PREVIOUS_KEYS ${prevRaw}.`);

    if(env.COMTRADE_CLIENT!=='real')errors.push('COMTRADE_CLIENT must be real.');
    if(missing(env,'COMTRADE_API_KEY'))errors.push('COMTRADE_API_KEY is required.');
    if(env.DISCOVERY_ENGINE==='mock')errors.push('DISCOVERY_ENGINE=mock is forbidden.');
    if(env.STORAGE_BACKEND!=='s3')errors.push('STORAGE_BACKEND must be s3; local disk is not durable.');
    for(const key of ['STORAGE_BUCKET','STORAGE_REGION'])if(missing(env,key))errors.push(`${key} is required.`);
    if(environment==='staging'){
      if(missing(env,'STORAGE_IDENTITY_SHA256'))errors.push('STORAGE_IDENTITY_SHA256 is required in staging.');
      else if(env.STORAGE_IDENTITY_SHA256!==storageIdentityFingerprint(env))errors.push('Object storage does not match the pinned staging storage identity.');
    }
    if(env.DOCUMENT_MALWARE_SCANNER!=='http')errors.push('DOCUMENT_MALWARE_SCANNER must be http.');
    if(missing(env,'DOCUMENT_MALWARE_SCANNER_URL'))errors.push('DOCUMENT_MALWARE_SCANNER_URL is required.');
    // The scanner receives customer documents; plaintext transport would expose them.
    else if(!/^https:\/\//i.test(env.DOCUMENT_MALWARE_SCANNER_URL??''))errors.push('DOCUMENT_MALWARE_SCANNER_URL must be https.');
    if(env.RATIONALE_WRITER==='claude'&&missing(env,'ANTHROPIC_API_KEY'))errors.push('ANTHROPIC_API_KEY is required when Claude rationale writing is enabled.');
    if(!['http','resend'].includes(env.NOTIFICATION_PROVIDER??''))errors.push('NOTIFICATION_PROVIDER must be http or resend.');
    if(env.NOTIFICATION_PROVIDER==='resend'){
      if(missing(env,'NOTIFICATION_FROM_EMAIL'))errors.push('NOTIFICATION_FROM_EMAIL is required and must be a verified Resend sender.');
      // Non-production real environments must not be able to email arbitrary people.
      if(environment!=='production'&&missing(env,'NOTIFICATION_ALLOWED_RECIPIENTS')&&missing(env,'NOTIFICATION_REDIRECT_TO'))
        errors.push('NOTIFICATION_ALLOWED_RECIPIENTS or NOTIFICATION_REDIRECT_TO is required outside production so staging cannot email arbitrary users.');
    }
    if(env.NOTIFICATION_PROVIDER==='resend'){
      if(missing(env,'RESEND_API_KEY')&&missing(env,'NOTIFICATION_PROVIDER_API_KEY'))errors.push('RESEND_API_KEY is required.');
    }else{
      if(missing(env,'NOTIFICATION_PROVIDER_API_KEY'))errors.push('NOTIFICATION_PROVIDER_API_KEY is required.');
      if(missing(env,'NOTIFICATION_PROVIDER_URL'))errors.push('NOTIFICATION_PROVIDER_URL is required.');
    }
    if(role==='web'&&missing(env,'NEXT_PUBLIC_APP_URL'))errors.push('NEXT_PUBLIC_APP_URL is required.');
    // The public app URL is baked into the client bundle and is where cookies are scoped.
    else if(role==='web'&&!/^https:\/\//i.test(env.NEXT_PUBLIC_APP_URL??''))errors.push('NEXT_PUBLIC_APP_URL must be https so session cookies are Secure.');

    const googlePair = oauthProviderPairProblem(env, 'AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET', 'Google');
    if (googlePair) errors.push(googlePair);
    const applePair = oauthProviderPairProblem(env, 'AUTH_APPLE_ID', 'AUTH_APPLE_SECRET', 'Apple');
    if (applePair) errors.push(applePair);
    for(const key of ['AUTH_GOOGLE_ID','AUTH_GOOGLE_SECRET','AUTH_APPLE_ID','AUTH_APPLE_SECRET'] as const){
      const value = env[key]?.trim();
      if(value && FORBIDDEN_SECRET_VALUES.has(value))errors.push(`${key} is a known placeholder value.`);
    }
  }
  // Runs in EVERY environment, not just real ones: the check that matters most locally is
  // "you have a live key on your laptop", which a real-environment-only guard would miss.
  // The web role serves checkout and the webhook; the worker runs the lapse sweep, which
  // needs no gateway credentials at all.
  if(role==='web')errors.push(...razorpayProblems(env,environment));

  if(errors.length)throw new Error(`Invalid ${environment} ${role} configuration: ${errors.join(' ')}`);
  return {environment,role,storage_backend:env.STORAGE_BACKEND??'local'};
}
