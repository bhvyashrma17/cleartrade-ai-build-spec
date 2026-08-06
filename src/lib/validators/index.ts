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
