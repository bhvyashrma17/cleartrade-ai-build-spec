import {SanctionsScreeningResultState} from '@prisma/client';
import {AccessDenied} from '@/components/access-denied';
import {SanctionsSourceHealthPanel} from '@/components/ops/SanctionsSourceHealthPanel';
import {Card,EmptyState,PageHeader,StatusChip} from '@/components/ui';
import {requirePortalAccess} from '@/lib/auth';
import {prisma} from '@/lib/prisma';
import {canViewSanctionsSourceHealth,sanctionsSourceHealth} from '@/lib/sanctions/source-health';

export default async function SanctionsReviewPage(){
  const principal=await requirePortalAccess('/ops');
  // E5: unchanged gate. Sanctions source health is an internal control surface — exporters,
  // ordinary agents and unauthenticated callers must not reach it.
  if(!canViewSanctionsSourceHealth(principal.role))return <AccessDenied message="Sanctions review is limited to Ops supervisors and administrators."/>;
  const [health,cases]=await Promise.all([sanctionsSourceHealth(),prisma.sanctionsScreeningCase.findMany({where:{result_state:{in:[SanctionsScreeningResultState.possible_match,SanctionsScreeningResultState.insufficient_screening_coverage]}},include:{source_entity:true,decisions:{orderBy:{created_at:'desc'},take:1}},orderBy:{created_at:'asc'}})]);
  return <main className="space-y-5">
    <PageHeader title="Sanctions review" description="Possible matches require human determination. Decisions are append-only." />

    <SanctionsSourceHealthPanel health={health}/>

    <section className="space-y-3"><h2 className="font-semibold">Review queue</h2>{cases.length===0?<EmptyState bordered title="No unresolved possible matches." />:cases.map(item=><Card key={item.id} as="article" inset="md"><div className="flex justify-between gap-3"><div><p className="font-normal">{item.searched_name}</p><p className="text-sm text-[var(--color-text-secondary)]">{item.searched_country??'Country unavailable'} · candidate {item.source_entity?.name??'coverage review'}</p></div><StatusChip label={item.result_state==='possible_match'?'Possible match':'Screening incomplete'} tone="critical" icon="alert"/></div><pre className="mt-3 overflow-auto rounded bg-surface-muted p-3 text-xs">{JSON.stringify(item.evidence,null,2)}</pre><p className="mt-2 text-xs text-[var(--color-text-secondary)]">Algorithm {item.algorithm_version}. Submit a decision through the sanctions review API; prior decisions are retained.</p></Card>)}</section>
  </main>;
}
