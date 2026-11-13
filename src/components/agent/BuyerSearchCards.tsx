/**
 * "Where to search" on the agent's Exporter 360, Buyer Discovery tab (D-048, docs/38 §1.4): the
 * hand-off card of every market handed off to buyer discovery. One group per market, its whole-market
 * card first, then its regions or cities in the order of its regional view; the ones holding 80% say
 * "Start here". Server-rendered: no client state.
 */

import { StatusChip } from '@/components/ui';
import type { ExporterSearchMarket, SearchCard } from '@/lib/regional-demand/search-cards';
import type { RegionalEvidence } from '@/lib/regional-demand/view';
import type { StatusIconName, StatusTone } from '@/types';

const EVIDENCE_CHIP: Record<RegionalEvidence, { tone: StatusTone; icon: StatusIconName }> = {
  your_product: { tone: 'positive', icon: 'check' },
  product_group: { tone: 'info', icon: 'check' },
  traders: { tone: 'info', icon: 'dot' },
  all_goods: { tone: 'neutral', icon: 'dot' },
  estimate: { tone: 'warning', icon: 'alert' },
  not_needed: { tone: 'neutral', icon: 'dot' },
};

const list = (values: string[]) => (values.length ? values.join(', ') : '—');

function Card({ card }: { card: SearchCard }) {
  const ports = card.gateways.filter((gateway) => gateway.kind === 'port').map((gateway) => gateway.name);
  const airports = card.gateways.filter((gateway) => gateway.kind === 'airport').map((gateway) => (gateway.iata ? `${gateway.name} (${gateway.iata})` : gateway.name));
  return (
    <li className="rounded-lg border border-[var(--color-border)] bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-primary">
          {card.rank ? `${card.rank}. ` : ''}
          {card.name}
          {card.code && card.code !== card.name ? <span className="ml-1 text-xs font-normal text-[var(--color-text-muted)]">{card.code}</span> : null}
        </p>
        {card.in_core ? <span className="whitespace-nowrap rounded-sm border border-line-strong px-1 py-0.5 text-[11px] font-medium text-primary">Start here: in the 80%</span> : null}
      </div>
      {card.share_percent != null ? <p className="text-xs text-[var(--color-text-secondary)]">{card.share_percent}% of the view</p> : null}
      <dl className="mt-2 space-y-1">
        <div>
          <dt className="inline text-[var(--color-text-secondary)]">Cities: </dt>
          <dd className="inline text-primary">{list(card.cities)}</dd>
        </div>
        <div>
          <dt className="inline text-[var(--color-text-secondary)]">Filter by: </dt>
          <dd className="inline text-primary">
            {card.search_terms.codes.length ? `codes ${card.search_terms.codes.join(', ')}` : 'no official code'}
            {'; '}
            {card.search_terms.postcode_prefixes ? `postcodes ${card.search_terms.postcode_prefixes.join(', ')}` : 'postcode prefixes not recorded yet'}
          </dd>
        </div>
        <div>
          <dt className="inline text-[var(--color-text-secondary)]">Gateways: </dt>
          <dd className="inline text-primary">
            {ports.length || airports.length ? [ports.length ? `ports ${ports.join(', ')}` : null, airports.length ? `airports ${airports.join(', ')}` : null].filter(Boolean).join('; ') : '—'}
          </dd>
        </div>
      </dl>
    </li>
  );
}

export function BuyerSearchCards({ markets }: { markets: ExporterSearchMarket[] }) {
  return (
    <section aria-labelledby="where-to-search" className="space-y-3">
      <div>
        <h3 id="where-to-search" className="text-sm font-semibold text-primary">Where to search</h3>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          For each market handed off to buyer discovery: the whole market, then its regions or cities in the order of its regional view. Start with the ones marked “Start here”: together they hold 80%.
        </p>
      </div>
      {markets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--color-border-strong)] p-3 text-sm text-[var(--color-text-secondary)]">
          No markets have been handed off yet. They appear here when a Demand Discovery run for one of this exporter&apos;s products finishes.
        </p>
      ) : (
        markets.map((market, index) => {
          const { cards } = market;
          const chip = cards.evidence ? EVIDENCE_CHIP[cards.evidence.key] : null;
          return (
            <details key={market.market_assessment_id} open={index === 0} className="rounded-lg border border-[var(--color-border)] bg-surface-muted p-3">
              <summary className="cursor-pointer text-sm font-medium text-primary">
                {market.product.name} · {market.rank ? `${market.rank}. ` : ''}{cards.country_name}
                {cards.evidence ? ` · ${cards.evidence.label}` : ''}
              </summary>
              <div className="mt-3 space-y-3">
                {cards.evidence && chip ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip label={cards.evidence.label} tone={chip.tone} icon={chip.icon} size="sm" />
                    <span className="text-xs text-[var(--color-text-secondary)]">{cards.evidence.meaning}</span>
                  </div>
                ) : null}
                <ul className="grid gap-2 md:grid-cols-2">
                  {cards.cards.map((card) => (
                    <Card key={`${card.scope}:${card.code ?? card.name}`} card={card} />
                  ))}
                </ul>
                <div className="space-y-1 text-xs text-[var(--color-text-muted)]">
                  {cards.notes.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                  {cards.source ? (
                    <p>
                      Source:{' '}
                      <a href={cards.source.url} className="underline underline-offset-2" target="_blank" rel="noreferrer">
                        {cards.source.label}
                      </a>
                      .
                    </p>
                  ) : null}
                </div>
              </div>
            </details>
          );
        })
      )}
    </section>
  );
}
