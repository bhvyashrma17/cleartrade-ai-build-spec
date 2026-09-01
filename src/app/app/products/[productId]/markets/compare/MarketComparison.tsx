/**
 * Side-by-side market comparison.
 *
 * The rule that shapes this whole component: **a missing value is printed as its reason, never
 * as a number.** The tempting implementation renders a bar chart and treats `null` as `0`,
 * which silently ranks a market DOWN for evidence nobody has gathered yet — turning "we have
 * not looked at logistics" into "logistics here are bad". So every cell is text, and an
 * unestablished pillar says what is missing.
 *
 * The table scrolls horizontally inside its own container rather than letting the page scroll,
 * and collapses to per-market cards on narrow screens.
 */
import Link from 'next/link';
import { buttonClass, Card } from '@/components/ui';
import { CONFIDENCE_MEANING } from '@/lib/country-discovery/explanations';
import type { MarketDetailView, PillarKey } from '@/lib/country-discovery/market-view';
import { PILLAR_KEYS, PILLAR_LABELS } from '@/lib/country-discovery/market-view';

type Row = { label: string; value: (market: MarketDetailView) => React.ReactNode };

const HEADLINE_ROWS: Row[] = [
  {
    label: 'Attractiveness',
    value: (market) =>
      market.attractiveness == null
        ? <span className="text-slate">Not rankable</span>
        : <span className="text-lg font-medium text-bone">{market.attractiveness}</span>,
  },
  { label: 'Evidence confidence', value: (market) => `${market.evidence_confidence}%` },
  { label: 'Import market', value: (market) => market.market_size.display ?? <Missing>Not established</Missing> },
  {
    label: 'Growth (past)',
    value: (market) => (market.growth.display ? `${market.growth.display} a year` : <Missing>Not established</Missing>),
  },
  { label: 'India’s share', value: (market) => market.india_share.display ?? <Missing>Not established</Missing> },
  { label: 'Supplier competition', value: (market) => market.supplier_concentration.display ?? <Missing>Not established</Missing> },
  { label: 'Trade data period', value: (market) => market.trade_periods ?? <Missing>Not established</Missing> },
];

function Missing({ children }: { children: React.ReactNode }) {
  return <span className="text-slate">{children}</span>;
}

function pillarCell(market: MarketDetailView, key: PillarKey) {
  const pillar = market.pillars.find((entry) => entry.key === key);
  if (!pillar) return <Missing>Not established</Missing>;
  if (pillar.state === 'available') return <span className="font-medium text-bone">{pillar.score}</span>;
  // The reason, not a dash and never a zero.
  return <Missing>{pillar.not_established_because}</Missing>;
}

export function MarketComparison({ markets, productId, basePath = '/app/products' }: {
  markets: MarketDetailView[];
  productId: string;
  /** Lets the agent surface reuse this component under its own route tree. */
  basePath?: string;
}) {
  return (
    <div className="space-y-4">
      {/* Wide layout: one column per market. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <caption className="sr-only">Market comparison</caption>
          <thead>
            <tr>
              <th scope="col" className="w-40 border-b border-line py-2 text-left text-xs font-medium text-muted">
                Measure
              </th>
              {markets.map((market) => (
                <th key={market.country_code} scope="col" className="border-b border-line py-2 text-left text-sm font-medium text-bone">
                  <Link href={`${basePath}/${productId}/markets/${market.country_code}`} className="hover:underline">
                    {market.country}
                  </Link>
                  <span className="block text-xs font-normal text-muted">Rank #{market.rank}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HEADLINE_ROWS.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="border-b border-line py-2 text-left text-xs font-normal text-muted">{row.label}</th>
                {markets.map((market) => (
                  <td key={market.country_code} className="border-b border-line py-2 align-top text-bone">{row.value(market)}</td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row" colSpan={markets.length + 1} className="pt-4 pb-1 text-left text-xs uppercase tracking-wide text-muted">
                Detailed pillars
              </th>
            </tr>
            {PILLAR_KEYS.map((key) => (
              <tr key={key}>
                <th scope="row" className="border-b border-line py-2 text-left text-xs font-normal text-muted">{PILLAR_LABELS[key]}</th>
                {markets.map((market) => (
                  <td key={market.country_code} className="border-b border-line py-2 align-top">{pillarCell(market, key)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Narrow layout: the same facts, one card per market. */}
      <div className="space-y-3 sm:hidden">
        {markets.map((market) => (
          <Card key={market.country_code} as="article">
            <h2 className="text-base font-medium text-bone">
              <Link href={`${basePath}/${productId}/markets/${market.country_code}`}>{market.country}</Link>
              <span className="ml-2 text-xs font-normal text-muted">Rank #{market.rank}</span>
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              {HEADLINE_ROWS.map((row) => (
                <div key={row.label} className="flex justify-between gap-3 border-b border-line pb-2">
                  <dt className="text-xs text-muted">{row.label}</dt>
                  <dd className="text-right text-bone">{row.value(market)}</dd>
                </div>
              ))}
              {PILLAR_KEYS.map((key) => (
                <div key={key} className="flex justify-between gap-3 border-b border-line pb-2 last:border-0">
                  <dt className="text-xs text-muted">{PILLAR_LABELS[key]}</dt>
                  <dd className="text-right">{pillarCell(market, key)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted">{CONFIDENCE_MEANING}</p>
      <Link href={`${basePath}/${productId}/markets`} className={buttonClass('secondary', 'md')}>
        Back to all markets
      </Link>
    </div>
  );
}
