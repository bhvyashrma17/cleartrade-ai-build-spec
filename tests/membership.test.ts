import { createHmac } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { JobType, OrgTier, SubscriptionStatus } from '@prisma/client';
import {
  COMPARISON,
  DEFAULT_PLAN_PRICING,
  annualSavingPercent,
  availabilityFor,
  isPremiumPlanCode,
  monthlyEquivalent,
} from '../src/lib/billing/plans';
import { verifyWebhookSignature, isRazorpayConfigured, fromUnixSeconds } from '../src/lib/billing/razorpay';
import {
  RENEWAL_GRACE_HOURS,
  entitlesToPaid,
  resolveTier,
} from '../src/lib/billing/subscription-service';
import { isCostedJobType, tierMayCauseCostedWork } from '../src/lib/billing/costed-work';
import {
  assertSubscriptionTransition,
  canTransitionSubscription,
  grantsAccess,
  isTerminalSubscriptionStatus,
  toSubscriptionStatus,
} from '../src/lib/state-machines/subscription';
import { minTierFor } from '../src/lib/permissions';
import { validateRuntimeEnvironment } from '../src/lib/runtime-config';
import { PREVIEW_BUYERS, PREVIEW_MARKETS, SAMPLE_DISCLAIMER } from '../src/lib/billing/preview';
import { prisma } from '../src/lib/prisma';

afterAll(() => prisma.$disconnect());

/**
 * The fixtures below are plain records; `NodeJS.ProcessEnv` in this project requires
 * `NODE_ENV`, which most of these deliberately omit. One cast helper, so the intent stays
 * visible instead of being buried under an `as` at every call site.
 */
const asEnv = (...parts: Record<string, string>[]) =>
  Object.assign({}, ...parts) as NodeJS.ProcessEnv;

// ---------------------------------------------------------------------------

describe('the pricing table is wired to the permission matrix', () => {
  /**
   * The guard the whole `plans.ts` design exists for: a marketing table maintained as free
   * text drifts from the enforcement matrix, and the drift is invisible until a customer
   * pays for something the API then refuses.
   */
  test('nothing gated above free is advertised as included on Free', () => {
    for (const feature of COMPARISON) {
      const advertised = availabilityFor(feature, 'free');
      const required = minTierFor(feature.capability);
      if (advertised === 'included') {
        expect(required, `${feature.capability} is shown as included on Free`).not.toBe(OrgTier.paid);
      } else {
        expect(required, `${feature.capability} is withheld from Free but is not paid-gated`).toBe(OrgTier.paid);
      }
    }
  });

  test('every paid-gated feature is included on Premium', () => {
    for (const feature of COMPARISON) {
      expect(availabilityFor(feature, 'premium_monthly'), feature.capability).toBe('included');
      expect(availabilityFor(feature, 'premium_annual'), feature.capability).toBe('included');
    }
  });

  test('the table would catch a capability moving tiers', () => {
    // Proves the check can fail — a coupling test that can never fail is not a test.
    // `demand_discovery.run` is paid, so Free must not show it as included.
    const discovery = COMPARISON.find((f) => f.capability === 'demand_discovery.run');
    expect(discovery).toBeDefined();
    expect(availabilityFor(discovery!, 'free')).not.toBe('included');
  });

  test('a locked feature with a sample is marked preview, not a bare cross', () => {
    const discovery = COMPARISON.find((f) => f.capability === 'demand_discovery.run')!;
    expect(availabilityFor(discovery, 'free')).toBe('preview');
  });

  test('prices are decimal strings with a currency, never bare numbers', () => {
    for (const price of Object.values(DEFAULT_PLAN_PRICING)) {
      expect(typeof price.amount).toBe('string');
      expect(price.currency).toMatch(/^[A-Z]{3}$/);
      expect(Number(price.amount)).toBeGreaterThan(0);
    }
  });

  test('annual is cheaper per month than monthly, and the saving is reported', () => {
    const perMonth = Number(monthlyEquivalent(DEFAULT_PLAN_PRICING.premium_annual, 'premium_annual'));
    expect(perMonth).toBeLessThan(Number(DEFAULT_PLAN_PRICING.premium_monthly.amount));
    expect(annualSavingPercent(DEFAULT_PLAN_PRICING)).toBeGreaterThan(0);
  });

  test('the shipped default is ₹2,000/month with a genuine annual discount', () => {
    // Pinned because the price is quoted in three rendered places (plans page, overview
    // banner, comparison copy) and read from config in all of them — a silent change to
    // the seed default should surface here rather than in a customer's invoice.
    expect(DEFAULT_PLAN_PRICING.premium_monthly.amount).toBe('2000.0000');
    expect(DEFAULT_PLAN_PRICING.premium_monthly.currency).toBe('INR');
    expect(annualSavingPercent(DEFAULT_PLAN_PRICING)).toBe(16);
  });

  test('annualSavingPercent reports nothing when annual is not a saving', () => {
    expect(annualSavingPercent({
      premium_monthly: { amount: '100', currency: 'INR' },
      premium_annual: { amount: '1200', currency: 'INR' },
    })).toBeNull();
  });

  test('plan codes are recognised, and arbitrary strings are not', () => {
    expect(isPremiumPlanCode('premium_annual')).toBe(true);
    expect(isPremiumPlanCode('free')).toBe(false);
    expect(isPremiumPlanCode('premium_lifetime')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('webhook signature verification', () => {
  const secret = 'whsec_test_2f9a4c1e8b7d6053';
  const body = JSON.stringify({ event: 'subscription.activated', payload: { subscription: { entity: { id: 'sub_1' } } } });
  const sign = (raw: string, key = secret) => createHmac('sha256', key).update(raw, 'utf8').digest('hex');

  test('a correctly signed body is accepted', () => {
    expect(verifyWebhookSignature(body, sign(body), secret)).toBe(true);
  });

  test('a tampered body is rejected', () => {
    const signature = sign(body);
    const tampered = body.replace('sub_1', 'sub_2');
    expect(verifyWebhookSignature(tampered, signature, secret)).toBe(false);
  });

  test('a signature from a different secret is rejected', () => {
    expect(verifyWebhookSignature(body, sign(body, 'whsec_other'), secret)).toBe(false);
  });

  test('a missing signature is rejected rather than skipped', () => {
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyWebhookSignature(body, '', secret)).toBe(false);
  });

  test('a wrong-length signature is rejected without throwing', () => {
    // `timingSafeEqual` throws on unequal lengths; the length pre-check is what stops that
    // becoming a 500 on an endpoint anyone can POST to.
    expect(() => verifyWebhookSignature(body, 'abc123', secret)).not.toThrow();
    expect(verifyWebhookSignature(body, 'abc123', secret)).toBe(false);
  });

  test('re-serialized JSON does not verify — the RAW body is what is signed', () => {
    // The reason `request.text()` is read once and parsed from that same string. A caller
    // who signs `JSON.stringify(JSON.parse(body))` with different key order gets a
    // different digest, which is exactly how this check gets "fixed" by being removed.
    const reordered = JSON.stringify({ payload: { subscription: { entity: { id: 'sub_1' } } }, event: 'subscription.activated' });
    expect(verifyWebhookSignature(reordered, sign(body), secret)).toBe(false);
  });
});

describe('gateway configuration is all-or-nothing', () => {
  const full: Record<string, string> = {
    RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'secret',
    RAZORPAY_WEBHOOK_SECRET: 'whsec', RAZORPAY_PLAN_ID_MONTHLY: 'plan_m',
    RAZORPAY_PLAN_ID_ANNUAL: 'plan_a',
  };

  test('all five present means configured', () => {
    expect(isRazorpayConfigured(asEnv(full))).toBe(true);
  });

  test('any one missing means NOT configured', () => {
    for (const key of Object.keys(full)) {
      const partial = { ...full };
      delete partial[key];
      expect(isRazorpayConfigured(asEnv(partial)), `${key} missing`).toBe(false);
    }
  });

  test('an empty string counts as missing, not as set', () => {
    expect(isRazorpayConfigured(asEnv(full, { RAZORPAY_WEBHOOK_SECRET: '   ' }))).toBe(false);
  });
});

describe('unix timestamps from the gateway', () => {
  test('a real timestamp converts', () => {
    expect(fromUnixSeconds(1_800_000_000)?.getTime()).toBe(1_800_000_000_000);
  });

  test('the nulls sent before the first charge stay null rather than becoming 1970', () => {
    // A `new Date(0)` here would set `paid_until` to the epoch and revoke access instantly.
    for (const value of [null, undefined, 0, -1, Number.NaN]) {
      expect(fromUnixSeconds(value as number | null)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------

describe('subscription state machine', () => {
  test('a terminal membership cannot be reopened by a late webhook', () => {
    for (const terminal of [SubscriptionStatus.cancelled, SubscriptionStatus.completed, SubscriptionStatus.expired]) {
      expect(isTerminalSubscriptionStatus(terminal)).toBe(true);
      expect(canTransitionSubscription(terminal, SubscriptionStatus.active)).toBe(false);
      expect(() => assertSubscriptionTransition(terminal, SubscriptionStatus.active)).toThrow(/already ended/);
    }
  });

  test('a renewal reports the same status and must be accepted, not rejected', () => {
    // `subscription.charged` on an already-active subscription carries the new
    // `current_end`. Treating it as an invalid transition would expire every member at
    // the end of their first period.
    const effects = assertSubscriptionTransition(SubscriptionStatus.active, SubscriptionStatus.active);
    expect(effects.same_state_refresh).toBe(true);
    expect(effects.grants_access).toBe(true);
  });

  test('halted still grants access — a failed retry is not an eviction', () => {
    expect(grantsAccess(SubscriptionStatus.halted)).toBe(true);
    expect(canTransitionSubscription(SubscriptionStatus.halted, SubscriptionStatus.active)).toBe(true);
  });

  test('cancelled still grants access until the paid-through date passes', () => {
    expect(grantsAccess(SubscriptionStatus.cancelled)).toBe(true);
  });

  test('expired and completed grant nothing', () => {
    expect(grantsAccess(SubscriptionStatus.expired)).toBe(false);
    expect(grantsAccess(SubscriptionStatus.completed)).toBe(false);
  });

  test('pause and resume round-trip, because production subscribes to both events', () => {
    // `subscription.paused` -> `subscription.resumed` reports `active` again. Without the
    // edge back out of `paused`, every resumed membership would be rejected as illegal.
    expect(canTransitionSubscription(SubscriptionStatus.active, SubscriptionStatus.paused)).toBe(true);
    expect(canTransitionSubscription(SubscriptionStatus.paused, SubscriptionStatus.active)).toBe(true);
    expect(isTerminalSubscriptionStatus(SubscriptionStatus.paused)).toBe(false);
  });

  test('paused keeps access — a deliberate pause does not confiscate paid-for time', () => {
    expect(grantsAccess(SubscriptionStatus.paused)).toBe(true);
  });

  test('paused is distinct from halted, so a pause never reads as a declined card', () => {
    expect(SubscriptionStatus.paused).not.toBe(SubscriptionStatus.halted);
    expect(toSubscriptionStatus('paused')).toBe(SubscriptionStatus.paused);
  });

  test('an unrecognised provider status maps to null, never to a default', () => {
    // Defaulting to active would grant access on a status we do not understand; defaulting
    // to expired would revoke a paying member's access because Razorpay shipped a new name.
    expect(toSubscriptionStatus('some_future_state')).toBeNull();
    expect(toSubscriptionStatus('active')).toBe(SubscriptionStatus.active);
    expect(toSubscriptionStatus('  ACTIVE ')).toBe(SubscriptionStatus.active);
  });
});

// ---------------------------------------------------------------------------

describe('entitlement needs BOTH a live status and an unexpired clock', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const future = new Date('2026-07-15T12:00:00Z');
  const past = new Date('2026-05-15T12:00:00Z');

  test('active plus a future date grants access', () => {
    expect(entitlesToPaid({ status: SubscriptionStatus.active, paid_until: future }, now)).toBe(true);
  });

  test('active with an EXPIRED date does not — this is the missed-webhook case', () => {
    // The control that stops "we were never told they stopped paying" meaning "they keep
    // access forever".
    expect(entitlesToPaid({ status: SubscriptionStatus.active, paid_until: past }, now)).toBe(false);
  });

  test('an expired status with a future date does not grant access either', () => {
    expect(entitlesToPaid({ status: SubscriptionStatus.expired, paid_until: future }, now)).toBe(false);
  });

  test('the renewal grace window holds access across the period boundary', () => {
    // Razorpay charges at the boundary and the webhook carrying the new date lands after.
    // Without the grace window, every member is briefly unentitled mid-renewal.
    const justLapsed = new Date(now.getTime() - (RENEWAL_GRACE_HOURS - 1) * 3_600_000);
    const wellLapsed = new Date(now.getTime() - (RENEWAL_GRACE_HOURS + 1) * 3_600_000);
    expect(entitlesToPaid({ status: SubscriptionStatus.active, paid_until: justLapsed }, now)).toBe(true);
    expect(entitlesToPaid({ status: SubscriptionStatus.active, paid_until: wellLapsed }, now)).toBe(false);
  });

  test('a paused membership still lapses on its paid-through date', () => {
    // Access is bounded by the date, not by the pause: paused-with-time-left keeps access,
    // paused-past-the-date does not, so a pause cannot become indefinite free access.
    expect(entitlesToPaid({ status: SubscriptionStatus.paused, paid_until: future }, now)).toBe(true);
    expect(entitlesToPaid({ status: SubscriptionStatus.paused, paid_until: past }, now)).toBe(false);
  });

  test('a just-authorized mandate with no period yet grants access', () => {
    expect(entitlesToPaid({ status: SubscriptionStatus.authenticated, paid_until: null }, now)).toBe(true);
  });

  test('a null period on any other status does not grant access', () => {
    expect(entitlesToPaid({ status: SubscriptionStatus.created, paid_until: null }, now)).toBe(false);
    expect(entitlesToPaid({ status: SubscriptionStatus.active, paid_until: null }, now)).toBe(false);
  });
});

describe('resolveTier reconciles both grant paths', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const past = new Date('2026-01-01T00:00:00Z');

  test('a paid commitment fee is non-expiring and survives a lapsed subscription', () => {
    // The pilot cohort paid the fee before memberships existed. A lapse sweep must never
    // downgrade them.
    const tier = resolveTier(
      { commitment_fee_status: 'paid', tier: OrgTier.paid },
      { status: SubscriptionStatus.expired, paid_until: past },
      now,
    );
    expect(tier).toBe(OrgTier.paid);
  });

  test('a waived fee behaves the same', () => {
    expect(resolveTier({ commitment_fee_status: 'waived', tier: OrgTier.paid }, null, now)).toBe(OrgTier.paid);
  });

  test('a lapsed membership with no fee drops to free, never below', () => {
    // Dropping to guest would make the tenant purgeable by scripts/purge-guests.ts.
    const tier = resolveTier(
      { commitment_fee_status: 'due', tier: OrgTier.paid },
      { status: SubscriptionStatus.expired, paid_until: past },
      now,
    );
    expect(tier).toBe(OrgTier.free);
  });

  test('a guest stays a guest', () => {
    expect(resolveTier({ commitment_fee_status: 'not_due', tier: OrgTier.guest }, null, now)).toBe(OrgTier.guest);
  });
});

// ---------------------------------------------------------------------------

describe('free tenants cannot cause costed work', () => {
  test('the metered job types are the ones that call a paid provider', () => {
    for (const type of [JobType.demand_discovery, JobType.buyer_discovery, JobType.buyer_intelligence, JobType.document_generation, JobType.report_export]) {
      expect(isCostedJobType(type), type).toBe(true);
    }
  });

  test('readiness is premium-adjacent but costs nothing, so it is not listed', () => {
    // Over-listing would turn a cost control into a shadow permission matrix that
    // disagrees with the real one.
    expect(isCostedJobType(JobType.readiness_assessment)).toBe(false);
  });

  test('scheduled platform ingests are not tenant-triggered costed work', () => {
    expect(isCostedJobType(JobType.comtrade_ingest)).toBe(false);
    expect(isCostedJobType(JobType.sanctions_ingest)).toBe(false);
  });

  test('only paid tenants may cause costed work', () => {
    expect(tierMayCauseCostedWork(OrgTier.guest)).toBe(false);
    expect(tierMayCauseCostedWork(OrgTier.free)).toBe(false);
    expect(tierMayCauseCostedWork(OrgTier.paid)).toBe(true);
  });
});

describe('the webhook handles every event production subscribes to', () => {
  /**
   * The dashboard's event list and this route's allowlist are two places that must agree,
   * and they are edited in different systems by different people. An event Razorpay sends
   * that the route does not list is acknowledged and silently discarded.
   */
  const SUBSCRIBED_IN_PRODUCTION = [
    'subscription.activated', 'subscription.charged', 'subscription.pending',
    'subscription.halted', 'subscription.paused', 'subscription.resumed',
    'subscription.cancelled', 'subscription.completed',
  ];

  test('every subscribed event is in the route allowlist', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile('src/app/api/v1/billing/razorpay/webhook/route.ts', 'utf8');
    const block = source.slice(source.indexOf('const HANDLED_EVENTS'), source.indexOf(']);', source.indexOf('const HANDLED_EVENTS')));
    for (const event of SUBSCRIBED_IN_PRODUCTION) {
      expect(block, `${event} is enabled in the Razorpay dashboard but not handled`).toContain(event);
    }
  });
});

describe('the free-tier demo spends nothing and claims nothing', () => {
  test('preview fixtures are labelled as preview evidence', () => {
    // `evidence-environment.ts` already classifies `preview` as non-real, so these values
    // are excluded from real-workflow queries by machinery that predates this feature.
    for (const market of PREVIEW_MARKETS) expect(market.evidence_origin).toBe('preview');
    for (const buyer of PREVIEW_BUYERS) expect(buyer.evidence_origin).toBe('preview');
  });

  test('the disclaimer says it is neither the reader’s data nor live data', () => {
    expect(SAMPLE_DISCLAIMER).toMatch(/not your data/i);
    expect(SAMPLE_DISCLAIMER).toMatch(/not live trade data/i);
  });

  test('sample buyers carry no contact details at all', () => {
    // A plausible-looking fake email someone tries to mail is worse than a locked state.
    for (const buyer of PREVIEW_BUYERS) {
      expect(JSON.stringify(buyer)).not.toMatch(/@/);
      expect(buyer).not.toHaveProperty('contacts');
    }
  });

  test('sample buyer names are visibly samples, not real importers', () => {
    for (const buyer of PREVIEW_BUYERS) expect(buyer.display_name).toMatch(/^Sample /);
  });

  test('the preview module imports no data source', async () => {
    // The rule stated at the top of preview.ts, enforced rather than trusted.
    const { readFile } = await import('node:fs/promises');
    const source = await readFile('src/lib/billing/preview.ts', 'utf8');
    const body = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    for (const forbidden of ['/prisma', 'discovery', 'comtrade', 'anthropic', 'fetch(']) {
      expect(body.toLowerCase(), `preview.ts references ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------

describe('payment configuration fails closed at boot', () => {
  const base: Record<string, string> = {
    NODE_ENV: 'production', APP_ENV: 'production', DATABASE_ENVIRONMENT: 'production',
    DATABASE_URL: 'postgresql://app@db.internal/cleartrade_production?sslmode=require',
    DIRECT_DATABASE_URL: 'postgresql://app@db-direct.internal/cleartrade_production?sslmode=require',
    AUTH_SECRET: 'Kq7Zx2Vb9Nm4Tp1Rw6Yc3Fh8Ls5Jd0Ga', GUEST_IP_HASH_SECRET: 'Bn3Xq8Wz1Cv6Rt4Ym9Pk2Hs7Ld5Fj0Ae',
    IMPORT_BUYER_REF_SECRET: 'Mv5Tz9Qw2Nb7Xc4Rp1Yk8Hd3Gs6Lf0Ja', IMPORT_BUYER_REF_KEY_VERSION: 'v1',
    IMPORT_RAW_IDENTITY_ENCRYPTION_KEY: Buffer.from('9f2c7b41a8e05d63'.repeat(4), 'hex').toString('base64'),
    IMPORT_RAW_IDENTITY_KEY_VERSION: 'v1', OPERATIONS_TOKEN: 'Zr6Hn2Kd9Tq4Wm7Bx1Vc5Yp8Ls3Gf0Ju',
    COMTRADE_CLIENT: 'real', COMTRADE_API_KEY: 'provider-key', DISCOVERY_ENGINE: 'warehouse',
    STORAGE_BACKEND: 's3', STORAGE_BUCKET: 'bucket', STORAGE_REGION: 'region',
    DOCUMENT_MALWARE_SCANNER: 'http', DOCUMENT_MALWARE_SCANNER_URL: 'https://scanner.internal/scan',
    NOTIFICATION_PROVIDER: 'http', NOTIFICATION_PROVIDER_API_KEY: 'provider-key',
    NOTIFICATION_PROVIDER_URL: 'https://notifications.internal/send',
    NEXT_PUBLIC_APP_URL: 'https://cleartrade.in',
  };

  const live: Record<string, string> = {
    RAZORPAY_KEY_ID: 'rzp_live_9f2c7b41a8e0', RAZORPAY_KEY_SECRET: 'Qw8Nb3Xc7Rp2Yk5Hd9Gs4Lf1JaMv6Tz',
    RAZORPAY_WEBHOOK_SECRET: 'Zx4Vb8Nm2Tp6Rw1Yc9Fh3Ls7Jd5GaKq', RAZORPAY_PLAN_ID_MONTHLY: 'plan_MonThLy01',
    RAZORPAY_PLAN_ID_ANNUAL: 'plan_AnnUaL01',
  };


  test('a complete production web configuration validates', () => {
    expect(validateRuntimeEnvironment('web', asEnv(base, live))).toMatchObject({ environment: 'production', role: 'web' });
  });

  test('production refuses to boot with payments unconfigured', () => {
    // cleartrade.in with payments off is a storefront with no till: every Upgrade button
    // renders disabled, which is a silent revenue outage nobody gets paged for.
    expect(() => validateRuntimeEnvironment('web', asEnv(base))).toThrow(/Payments are not configured/);
  });

  test('production may run without payments DELIBERATELY, via one explicit variable', () => {
    // The escape hatch that stops this check becoming a deploy landmine on a site that is
    // already serving. Arriving here by forgetting something is still impossible.
    expect(() => validateRuntimeEnvironment('web', asEnv(base, { PAYMENTS_DISABLED: 'true' }))).not.toThrow();
  });

  test('claiming payments are disabled while credentials are set is refused as ambiguous', () => {
    expect(() => validateRuntimeEnvironment('web', asEnv(base, live, { PAYMENTS_DISABLED: 'true' })))
      .toThrow(/ambiguous/);
  });

  test('a non-"true" value does not disable the check — only the exact opt-in does', () => {
    for (const value of ['1', 'yes', 'TRUE', '']) {
      expect(() => validateRuntimeEnvironment('web', asEnv(base, { PAYMENTS_DISABLED: value })), value)
        .toThrow(/Payments are not configured/);
    }
  });

  test('partial configuration is refused — keys without a webhook secret is the worst state', () => {
    const partial = { ...base, ...live };
    delete partial.RAZORPAY_WEBHOOK_SECRET;
    expect(() => validateRuntimeEnvironment('web', asEnv(partial)))
      .toThrow(/partially configured[\s\S]*RAZORPAY_WEBHOOK_SECRET/);
  });

  test('a TEST key in production is refused', () => {
    expect(() => validateRuntimeEnvironment('web', asEnv(base, live, { RAZORPAY_KEY_ID: 'rzp_test_abc123' })))
      .toThrow(/TEST key in production/);
  });

  test('a LIVE key outside production is refused', () => {
    // The check that matters most locally: a live key on a laptop charges real cards.
    expect(() => validateRuntimeEnvironment('web', asEnv(live, {
      NODE_ENV: 'development', APP_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/cleartrade_dev',
    }))).toThrow(/LIVE key in development/);
  });

  test('the two plans must be distinct objects', () => {
    expect(() => validateRuntimeEnvironment('web', asEnv(base, live, { RAZORPAY_PLAN_ID_ANNUAL: 'plan_MonThLy01' })))
      .toThrow(/must be two distinct Razorpay plans/);
  });

  test('the worker needs no gateway credentials — it only runs the lapse sweep', () => {
    expect(() => validateRuntimeEnvironment('worker', asEnv(base))).not.toThrow();
  });

  test('local development with payments unset is fine', () => {
    expect(() => validateRuntimeEnvironment('web', asEnv({
      NODE_ENV: 'development', APP_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/cleartrade_dev',
    }))).not.toThrow();
  });
});
