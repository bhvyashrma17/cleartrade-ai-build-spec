import {afterAll,describe,expect,test} from 'vitest';import {prisma} from '../src/lib/prisma';import {validateRuntimeEnvironment} from '../src/lib/runtime-config';import {operationsAuthorized} from '../src/lib/operations-auth';import {storageHealthcheck} from '../src/lib/document-storage';
afterAll(async()=>{await prisma.workerHeartbeat.deleteMany({where:{instance_id:{startsWith:'vitest-ops'}}});await prisma.$disconnect();});
const staging={NODE_ENV:'production',APP_ENV:'staging',DATABASE_ENVIRONMENT:'staging',DATABASE_URL:'postgresql://app@db.internal/cleartrade_staging?sslmode=require',DIRECT_DATABASE_URL:'postgresql://app@db-direct.internal/cleartrade_staging?sslmode=require',AUTH_SECRET:'Kq7Zx2Vb9Nm4Tp1Rw6Yc3Fh8Ls5Jd0Ga',GUEST_IP_HASH_SECRET:'Bn3Xq8Wz1Cv6Rt4Ym9Pk2Hs7Ld5Fj0Ae',IMPORT_BUYER_REF_SECRET:'Mv5Tz9Qw2Nb7Xc4Rp1Yk8Hd3Gs6Lf0Ja',IMPORT_BUYER_REF_KEY_VERSION:'v1',IMPORT_RAW_IDENTITY_ENCRYPTION_KEY:Buffer.from('9f2c7b41a8e05d63'.repeat(4),'hex').toString('base64'),IMPORT_RAW_IDENTITY_KEY_VERSION:'v1',OPERATIONS_TOKEN:'Zr6Hn2Kd9Tq4Wm7Bx1Vc5Yp8Ls3Gf0Ju',COMTRADE_CLIENT:'real',COMTRADE_API_KEY:'provider-key',DISCOVERY_ENGINE:'warehouse',STORAGE_BACKEND:'s3',STORAGE_BUCKET:'bucket',STORAGE_REGION:'region',DOCUMENT_MALWARE_SCANNER:'http',DOCUMENT_MALWARE_SCANNER_URL:'https://scanner.internal/scan',NOTIFICATION_PROVIDER:'http',NOTIFICATION_PROVIDER_API_KEY:'provider-key',NOTIFICATION_PROVIDER_URL:'https://notifications.internal/send',NEXT_PUBLIC_APP_URL:'https://staging.example.test'} as NodeJS.ProcessEnv;
describe('deployment safety',()=>{
  test('development is explicit and may use local storage',()=>expect(validateRuntimeEnvironment('web',{NODE_ENV:'development',APP_ENV:'development',DATABASE_URL:'postgresql://localhost/cleartrade_dev'})).toMatchObject({environment:'development',storage_backend:'local'}));
  test('staging fails closed on missing secrets, mock providers, local storage, and dev databases',()=>expect(()=>validateRuntimeEnvironment('web',{NODE_ENV:'production',APP_ENV:'staging',DATABASE_ENVIRONMENT:'staging',DATABASE_URL:'postgresql://localhost/cleartrade_dev',COMTRADE_CLIENT:'mock',STORAGE_BACKEND:'local'})).toThrow(/AUTH_SECRET.*mock|COMTRADE_CLIENT.*real/));
  test('a complete platform-neutral staging configuration validates',()=>expect(validateRuntimeEnvironment('worker',staging)).toMatchObject({environment:'staging',role:'worker',storage_backend:'s3'}));
  test('operational metrics use constant-time bearer-token authorization',()=>{const request=new Request('http://localhost/api/metrics',{headers:{authorization:`Bearer ${staging.OPERATIONS_TOKEN}`}}),previous=process.env.OPERATIONS_TOKEN;process.env.OPERATIONS_TOKEN='wrong-token-value-that-is-long-enough';expect(operationsAuthorized(request)).toBe(false);process.env.OPERATIONS_TOKEN=staging.OPERATIONS_TOKEN;expect(operationsAuthorized(request)).toBe(true);process.env.OPERATIONS_TOKEN=previous;});
  test('worker heartbeat state is durable and queryable',async()=>{const row=await prisma.workerHeartbeat.create({data:{id:'vitest-ops-heartbeat',instance_id:'vitest-ops-1',status:'degraded',last_seen_at:new Date(),last_error:'test failure',last_error_at:new Date(),consecutive_failures:1}});expect(row).toMatchObject({status:'degraded',consecutive_failures:1});});
  test('development local storage readiness creates a durable local root',async()=>expect(await storageHealthcheck()).toEqual({backend:'local',ready:true}));
});

// ---------------------------------------------------------------------------
// Phase 3 — startup fails closed on absent / weak / reused secrets
// ---------------------------------------------------------------------------

const without = (key: string) => { const e = { ...staging } as Record<string, unknown>; delete e[key]; return e as NodeJS.ProcessEnv; };
const withValue = (key: string, value: string) => ({ ...staging, [key]: value }) as NodeJS.ProcessEnv;

describe('staging fails closed on missing mandatory secrets', () => {
  const mandatory = [
    'DATABASE_URL', 'AUTH_SECRET', 'GUEST_IP_HASH_SECRET', 'IMPORT_BUYER_REF_SECRET',
    'IMPORT_BUYER_REF_KEY_VERSION', 'IMPORT_RAW_IDENTITY_ENCRYPTION_KEY',
    'IMPORT_RAW_IDENTITY_KEY_VERSION', 'OPERATIONS_TOKEN', 'COMTRADE_API_KEY',
    'STORAGE_BUCKET', 'STORAGE_REGION', 'DOCUMENT_MALWARE_SCANNER_URL',
    'NOTIFICATION_PROVIDER_API_KEY', 'NOTIFICATION_PROVIDER_URL', 'NEXT_PUBLIC_APP_URL',
  ];
  test.each(mandatory)('%s absent → startup throws', (key) => {
    expect(() => validateRuntimeEnvironment('web', without(key))).toThrow(new RegExp(key));
  });

  test('the migration role additionally requires an unpooled direct URL', () => {
    expect(() => validateRuntimeEnvironment('migration', without('DIRECT_DATABASE_URL'))).toThrow(/DIRECT_DATABASE_URL/);
    // ...which the web role does not need.
    expect(() => validateRuntimeEnvironment('web', without('DIRECT_DATABASE_URL'))).not.toThrow();
  });

  test('a fully valid staging configuration still validates (the checks are not vacuous)', () => {
    expect(validateRuntimeEnvironment('web', staging)).toMatchObject({ environment: 'staging', storage_backend: 's3' });
  });
});

describe('staging rejects weak, placeholder and development-grade secrets', () => {
  test.each(['AUTH_SECRET', 'GUEST_IP_HASH_SECRET', 'IMPORT_BUYER_REF_SECRET', 'OPERATIONS_TOKEN'])(
    '%s rejects the committed example placeholder',
    (key) => {
      expect(() => validateRuntimeEnvironment('web', withValue(key, 'REPLACE_WITH_SECRET_MANAGER_VALUE'))).toThrow(/placeholder/);
    },
  );

  test.each(['AUTH_SECRET', 'GUEST_IP_HASH_SECRET', 'IMPORT_BUYER_REF_SECRET', 'OPERATIONS_TOKEN'])(
    '%s rejects a repeated-character filler that meets the length floor',
    (key) => {
      // 'a'.repeat(32) is long enough but obviously not generated.
      expect(() => validateRuntimeEnvironment('web', withValue(key, 'a'.repeat(32)))).toThrow(new RegExp(key));
    },
  );

  test.each(['AUTH_SECRET', 'GUEST_IP_HASH_SECRET', 'IMPORT_BUYER_REF_SECRET', 'OPERATIONS_TOKEN'])(
    '%s rejects a too-short secret',
    (key) => {
      expect(() => validateRuntimeEnvironment('web', withValue(key, 'Kq7Zx2Vb'))).toThrow(/at least 32 characters/);
    },
  );

  test('the raw-identity key must be real 32-byte key material, not a stretched weak string', () => {
    // import-identity.ts silently SHA-256s anything that is not 32 decoded bytes. That
    // fallback must not be reachable in a real environment.
    // 'changeme' is caught earlier, by the placeholder rule — a different rejection, equally correct.
    expect(() => validateRuntimeEnvironment('web', withValue('IMPORT_RAW_IDENTITY_ENCRYPTION_KEY', 'changeme'))).toThrow(/IMPORT_RAW_IDENTITY_ENCRYPTION_KEY/);
    // 32 base64 characters decode to 24 bytes, not 32 — previously stretched via SHA-256.
    expect(() => validateRuntimeEnvironment('web', withValue('IMPORT_RAW_IDENTITY_ENCRYPTION_KEY', 'e'.repeat(32)))).toThrow(/32 bytes/);
  });

  test('a correctly generated raw-identity key is accepted', () => {
    const key = Buffer.from('0123456789abcdef'.repeat(4), 'hex').toString('base64');
    expect(() => validateRuntimeEnvironment('web', withValue('IMPORT_RAW_IDENTITY_ENCRYPTION_KEY', key))).not.toThrow();
  });
});

describe('staging rejects insecure transport and dev-labelled infrastructure', () => {
  test('database URL must request TLS', () => {
    expect(() => validateRuntimeEnvironment('web', withValue('DATABASE_URL', 'postgresql://app@db.internal/cleartrade_staging'))).toThrow(/sslmode/);
  });

  test('a development database URL is refused even with TLS', () => {
    expect(() => validateRuntimeEnvironment('web', withValue('DATABASE_URL', 'postgresql://app@localhost/cleartrade_dev?sslmode=require'))).toThrow(/test\/dev\/local/);
  });

  test('the direct migration URL is held to the same standard as the pooled URL', () => {
    expect(() => validateRuntimeEnvironment('migration', withValue('DIRECT_DATABASE_URL', 'postgresql://app@db.internal/cleartrade_dev?sslmode=require'))).toThrow(/direct database URL/);
    expect(() => validateRuntimeEnvironment('migration', withValue('DIRECT_DATABASE_URL', 'postgresql://app@db-direct.internal/cleartrade_staging'))).toThrow(/DIRECT_DATABASE_URL must request TLS/);
  });

  test('the malware scanner receives customer documents, so plaintext transport is refused', () => {
    expect(() => validateRuntimeEnvironment('web', withValue('DOCUMENT_MALWARE_SCANNER_URL', 'http://scanner.internal/scan'))).toThrow(/https/);
  });

  test('the public app URL must be https so session cookies can be Secure', () => {
    expect(() => validateRuntimeEnvironment('web', withValue('NEXT_PUBLIC_APP_URL', 'http://staging.example.test'))).toThrow(/https/);
  });

  test('local storage and mock providers remain forbidden in staging', () => {
    expect(() => validateRuntimeEnvironment('web', withValue('STORAGE_BACKEND', 'local'))).toThrow(/STORAGE_BACKEND must be s3/);
    expect(() => validateRuntimeEnvironment('web', withValue('COMTRADE_CLIENT', 'mock'))).toThrow(/COMTRADE_CLIENT must be real/);
    expect(() => validateRuntimeEnvironment('web', withValue('DISCOVERY_ENGINE', 'mock'))).toThrow(/DISCOVERY_ENGINE=mock/);
    expect(() => validateRuntimeEnvironment('web', withValue('DOCUMENT_MALWARE_SCANNER', 'development'))).toThrow(/must be http/);
  });
});

describe('key rotation state must be well-formed at startup, not at first use', () => {
  test('malformed previous-secret JSON fails at startup', () => {
    expect(() => validateRuntimeEnvironment('web', withValue('IMPORT_BUYER_REF_PREVIOUS_SECRETS', 'not-json'))).toThrow(/JSON object keyed by version/);
    expect(() => validateRuntimeEnvironment('web', withValue('IMPORT_RAW_IDENTITY_PREVIOUS_KEYS', '[]'))).toThrow(/JSON object keyed by version/);
  });

  test('a previous secret that is too short fails at startup', () => {
    expect(() => validateRuntimeEnvironment('web', withValue('IMPORT_BUYER_REF_PREVIOUS_SECRETS', JSON.stringify({ v0: 'short' })))).toThrow(/at least 32 characters/);
  });

  test('a well-formed previous-secret map is accepted', () => {
    const map = JSON.stringify({ v0: 'Pq2Wn8Zx5Tc1Rv6Ym3Kd9Hs4Lf7Gj0Ba' });
    expect(() => validateRuntimeEnvironment('web', withValue('IMPORT_BUYER_REF_PREVIOUS_SECRETS', map))).not.toThrow();
  });

  test('development is unaffected by every rule above', () => {
    // The hardening applies only to real workflow environments; development stays ergonomic.
    expect(validateRuntimeEnvironment('web', { NODE_ENV: 'development', APP_ENV: 'development', DATABASE_URL: 'postgresql://localhost/cleartrade_dev' } as NodeJS.ProcessEnv))
      .toMatchObject({ environment: 'development', storage_backend: 'local' });
  });
});

describe('social auth environment validation', () => {
  test('Google enablement requires both id and secret', () => {
    expect(() => validateRuntimeEnvironment('web', withValue('AUTH_GOOGLE_ID', 'google-id'))).toThrow(/AUTH_GOOGLE_SECRET/);
    expect(() => validateRuntimeEnvironment('web', withValue('AUTH_GOOGLE_SECRET', 'google-secret'))).toThrow(/AUTH_GOOGLE_ID/);
  });

  test('Apple enablement requires both id and secret', () => {
    expect(() => validateRuntimeEnvironment('web', withValue('AUTH_APPLE_ID', 'apple-id'))).toThrow(/AUTH_APPLE_SECRET/);
    expect(() => validateRuntimeEnvironment('web', withValue('AUTH_APPLE_SECRET', 'apple-secret'))).toThrow(/AUTH_APPLE_ID/);
  });

  test('staging still validates when Apple is not enabled', () => {
    expect(() => validateRuntimeEnvironment('web', { ...staging, AUTH_GOOGLE_ID: 'google-id', AUTH_GOOGLE_SECRET: 'google-secret' } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
