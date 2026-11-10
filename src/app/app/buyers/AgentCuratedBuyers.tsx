/**
 * EXP-06 for members: what happens to buyers, per product and market.
 *
 * Buyer discovery is agent-curated (docs/11 §7): `buyer_discovery.run` and lead creation deny
 * exporter roles, and the member's ClearTrade agent finds, vets and contacts importers. This page
 * used to render a search screen that the API refuses to every exporter ("Tell us which exporter
 * this buyer search is for"), found by the production check on 10 Nov 2026 (E-055). It now shows
 * what the member can act on: each product's latest Demand Discovery run, the markets it handed on
 * to buyer search, and — where an official importer list covers the market — how many importers
 * were found there, with the market's page one click away. Counts only, never the list (the same
 * rule as the market page).
 */

import Link from 'next/link';
import { Card, EmptyState, PageHeader, buttonClass } from '@/components/ui';

// A server-side copy of `V5Results`' helper: a function exported from a client module cannot be
// called while rendering on the server.
const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => {
  try {
    return REGION_NAMES.of(code) ?? code;
  } catch {
    return code;
  }
};

export interface CuratedMarket {
  assessment_id: string;
  country_code: string;
  rank: number | null;
  score: number | null;
  /** Importers found in an official list for this product and market; null where no list covers it. */
  importers: { count: number; source: string } | null;
}

export interface CuratedProduct {
  id: string;
  name: string;
  hs_code: string | null;
  run_completed_at: string | null;
  markets: CuratedMarket[];
}

export function AgentCuratedBuyers({ products }: { products: CuratedProduct[] }) {
  return (
    <>
      <PageHeader
        title="Buyers"
        description="Your ClearTrade agent finds and vets importers in the markets Demand Discovery hands on for each product, then contacts the right ones for you."
      />
      {products.length === 0 ? (
        <EmptyState
          title="No products yet"
          description="Add a product on Markets. Its Demand Discovery run hands its top markets on to buyer search."
          action={
            <Link href="/app/markets" className={buttonClass('primary', 'md')}>
              Add a product
            </Link>
          }
        />
      ) : (
        <div className="space-y-6">
          {products.map((product) => (
            <Card key={product.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-primary">
                  {product.name}
                  {product.hs_code ? <span className="ml-2 font-mono text-xs font-normal text-muted">HS {product.hs_code}</span> : null}
                </h2>
                {product.run_completed_at ? (
                  <p className="text-xs text-muted">Markets from the run of {new Date(product.run_completed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</p>
                ) : null}
              </div>
              {product.markets.length === 0 ? (
                <p className="mt-3 text-sm text-muted">
                  No market has been handed on to buyer search yet.{' '}
                  <Link href="/app/markets" className="font-semibold text-primary underline underline-offset-2">
                    Run Demand Discovery
                  </Link>{' '}
                  for this product.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {product.markets.map((market) => (
                    <li key={market.assessment_id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
                      <div className="min-w-0">
                        <Link href={`/app/markets/${market.assessment_id}`} className="text-sm font-medium text-primary underline-offset-2 hover:underline">
                          {market.rank != null ? `${market.rank}. ` : ''}
                          {countryName(market.country_code)}
                        </Link>
                        <p className="text-xs text-muted">
                          {market.importers
                            ? market.importers.count > 0
                              ? `${market.importers.count} ${market.importers.count === 1 ? 'importer' : 'importers'} found in the ${market.importers.source}; your agent reviews them`
                              : `No importer of this product in the ${market.importers.source} yet; your agent searches further`
                            : 'Your agent finds and vets importers here'}
                        </p>
                      </div>
                      {market.score != null ? (
                        <p className="shrink-0 text-sm text-bone">
                          <span className="font-mono">{market.score}</span>
                          <span className="ml-1 text-xs text-muted">/ 100</span>
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
