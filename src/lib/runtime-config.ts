import {appEnvironment,isRealWorkflowEnvironment} from '@/lib/evidence-environment';

export type RuntimeRole='web'|'worker'|'migration'|'scheduler';
const missing=(env:NodeJS.ProcessEnv,name:string)=>!env[name]?.trim();

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
  }
  if(errors.length)throw new Error(`Invalid ${environment} ${role} configuration: ${errors.join(' ')}`);
  return {environment,role,storage_backend:env.STORAGE_BACKEND??'local'};
}
