/**
 * Document generation engine — the seam between the product and whatever actually
 * renders a document, exactly mirroring `src/lib/discovery/engine.ts`.
 *
 * docs/07 §7.3: "each document needs source data, an AI-generated badge, last editor,
 * version number... Download PDF alone is not enough." This file is the contract that
 * lets the product make that promise without binding to a specific template engine or
 * PDF library. Everything on the far side — the job handler, the Document rows, the
 * download route, the UI — depends only on `DocumentGenerationEngine`. Swapping the mock
 * for a real renderer means writing one new class and changing one factory line.
 *
 * Deliberately NOT here: PDF library types, template file paths, font handling. Those
 * belong inside an implementation.
 */

/**
 * Everything a document is generated FROM. Sourced from the Deal Snapshot, never from
 * live Deal columns (docs/13 E1) — the caller is responsible for reading the frozen
 * snapshot, not this interface.
 */
export interface DocumentGenerationInput {
  doc_type: string;
  deal_id: string;
  version: number;
  snapshot: {
    buyer_legal_name: string;
    product_name: string | null;
    sku: string | null;
    quantity: string | null;
    unit: string | null;
    unit_price_amount: string | null;
    unit_price_currency: string | null;
    total_amount: string | null;
    total_currency: string | null;
    incoterm: string | null;
    incoterm_place: string | null;
    payment_terms: unknown;
    ship_window_start: Date | null;
    ship_window_end: Date | null;
    special_conditions: string | null;
  };
}

export interface DocumentGenerationResult {
  /** The rendered document. Plain text today — an implementation may return PDF bytes. */
  content: string;
  mime_type: string;
  file_extension: string;
  /** Free-form provenance (engine name, template version) for the AI-generated badge. */
  provenance?: Record<string, unknown>;
}

export interface DocumentGenerationEngine {
  /** Stable identifier recorded in `generation_inputs`, so a stored result says what produced it. */
  readonly name: string;
  render(input: DocumentGenerationInput): Promise<DocumentGenerationResult>;
}
