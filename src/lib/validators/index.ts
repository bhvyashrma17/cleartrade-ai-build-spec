/**
 * Zod schemas mirroring API request payloads (AGENTS.md folder contract). Route
 * handlers parse with these and turn a failed parse into the docs/09 §2
 * VALIDATION_ERROR shape via `zodFieldErrors()` — never a bare 400.
 */

import type { ZodError } from 'zod';
import { z } from 'zod';
import type { FieldError } from '@/types';

/** Flatten a ZodError into the `fields[]` shape `validationError()` expects. */
export function zodFieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    code: issue.code,
    message: issue.message,
  }));
}

export const createBuyerLeadSchema = z.object({
  product_id: z.string().min(1, 'A product is required.'),
  buyer_id: z.string().min(1, 'A buyer is required.'),
  /** Required only when the caller isn't a tenant-scoped exporter (route enforces this). */
  exporter_org_id: z.string().min(1).optional(),
});

export type CreateBuyerLeadInput = z.infer<typeof createBuyerLeadSchema>;

/**
 * Demand Discovery input.
 *
 * Product context arrives one of two ways and exactly one must be present:
 *   - `product_id` — a saved Product (free/paid tiers)
 *   - ad-hoc description + HS code — typed straight into the search (guest tier)
 *
 * Guests deliberately do NOT get a placeholder Product row created for them. The ad-hoc
 * text is snapshotted onto the DiscoveryRun instead, and only becomes a real Product if
 * they choose to save it at registration.
 */
export const createDiscoveryRunSchema = z
  .object({
    product_id: z.string().min(1).optional(),
    product_description: z.string().trim().min(3, 'Describe your product in a few words.').max(500).optional(),
    hs_code: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/, 'An HS code is 4 to 8 digits.')
      .optional(),
    target_countries: z.array(z.string().length(2)).max(20).optional(),
  })
  .refine((v) => Boolean(v.product_id) || Boolean(v.product_description), {
    message: 'Tell us what you export, or choose a saved product.',
    path: ['product_description'],
  })
  .refine((v) => !(v.product_id && v.product_description), {
    message: 'Choose a saved product or describe one — not both.',
    path: ['product_id'],
  });

export type CreateDiscoveryRunInput = z.infer<typeof createDiscoveryRunSchema>;

/** EXP-02 snapshots answers as data; question-level validation remains server-side. */
export const readinessAnswersSchema = z.object({
  answers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  action: z.enum(['save', 'submit']),
});
export type ReadinessAnswersInput = z.infer<typeof readinessAnswersSchema>;

/** Registration — upgrades a guest tenant in place, or creates a fresh free one. */
export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(120),
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
  organization_name: z.string().trim().min(1, 'Enter your company name.').max(200),
  /** Opt-in, never automatic: turn the guest's ad-hoc search input into a real Product. */
  save_discovery_input_as_product: z.boolean().optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
