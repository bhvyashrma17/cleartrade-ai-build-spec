import { describe, expect, test } from 'vitest';
import type { CountryEvidencePolicy } from '../src/lib/config';
import { buildCountryEvidencePlan, selectCommonAnnualPeriod } from '../src/lib/country-evidence/planner';
import { canonicalComtradeRequest } from '../src/lib/comtrade/request';

const policy:CountryEvidencePolicy={policy_version:'test-v1',history_years:5,annual_release_month_utc:8,minimum_candidate_coverage_ratio:.8,latest_period_freshness_days:90,closed_period_freshness_days:3650,supplier_distribution_freshness_days:90,supplier_coverage_min_ratio:.95,supplier_coverage_max_ratio:1.05,india_partner_code:'699',world_partner_code:'0',all_suppliers_partner_code:'all',candidate_strategy:'explicit_candidates_v1',allow_partial_execution:false};
const input={product_classification_id:'classification-1',hs_code:'090111',hs_revision:'HS2022',as_of_date:new Date('2026-08-22T00:00:00Z'),candidate_reporters:['842','276'],source_mode:'authenticated' as const,policy,policy_config_version:7};

describe('Country Evidence deterministic planner',()=>{
  test('freezes one common five-year period instead of using currentYear-1 at execution time',()=>{
    const plan=buildCountryEvidencePlan(input);
    expect(plan.latest_common_year).toBe(2025);
    expect(plan.period_set).toEqual([2021,2022,2023,2024,2025]);
    expect(plan.actual_history_years).toBe(5);
  });

  test('falls back to the newest year meeting the frozen cross-country coverage threshold',()=>{
    expect(selectCommonAnnualPeriod({...input,candidate_reporters:['276','842','826'],available_reporters_by_year:{2025:['276'],2024:['276','842','826']}})).toEqual({latest:2024,periods:[2020,2021,2022,2023,2024]});
    expect(()=>selectCommonAnnualPeriod({...input,available_reporters_by_year:{2025:['276']}})).toThrow(/No common annual period/);
  });

  test('creates World and India history plus latest supplier distribution for every reporter',()=>{
    const plan=buildCountryEvidencePlan(input);
    expect(plan.items).toHaveLength(22);
    for(const reporter of ['276','842']){
      expect(plan.items.filter(item=>item.reporter_code===reporter&&item.purpose==='WORLD_IMPORT_HISTORY')).toHaveLength(5);
      expect(plan.items.filter(item=>item.reporter_code===reporter&&item.purpose==='INDIA_IMPORT_HISTORY')).toHaveLength(5);
      expect(plan.items.filter(item=>item.reporter_code===reporter&&item.purpose==='LATEST_SUPPLIER_DISTRIBUTION')).toEqual([expect.objectContaining({period:2025,partner_scope:'all_suppliers',partner_code:'all'})]);
    }
  });

  test('has stable identity regardless of candidate input order and changes with policy or HS revision',()=>{
    const first=buildCountryEvidencePlan(input),reordered=buildCountryEvidencePlan({...input,candidate_reporters:['276','842']});
    expect(first.plan_key).toBe(reordered.plan_key);expect(first.items.map(item=>item.item_key)).toEqual(reordered.items.map(item=>item.item_key));
    expect(buildCountryEvidencePlan({...input,hs_revision:'HS2017'}).plan_key).not.toBe(first.plan_key);
    expect(buildCountryEvidencePlan({...input,policy:{...policy,latest_period_freshness_days:60}}).plan_key).not.toBe(first.plan_key);
  });

  test('freezes tiered freshness and deterministic quota priority',()=>{
    const items=buildCountryEvidencePlan(input).items;
    expect(items.find(item=>item.purpose==='WORLD_IMPORT_HISTORY'&&item.period===2025)?.freshness_days).toBe(90);
    expect(items.find(item=>item.purpose==='WORLD_IMPORT_HISTORY'&&item.period===2021)?.freshness_days).toBe(3650);
    expect(items.find(item=>item.purpose==='LATEST_SUPPLIER_DISTRIBUTION')?.freshness_days).toBe(90);
    expect(items.map(item=>item.priority)).toEqual([...items.map(item=>item.priority)].sort((a,b)=>a-b));
  });

  test('keeps fixture and authenticated plans cryptographically distinct',()=>{
    expect(buildCountryEvidencePlan({...input,source_mode:'fixture'}).plan_key).not.toBe(buildCountryEvidencePlan(input).plan_key);
  });

  test('fails closed for unconfirmed dimensions and supports an explicit all-suppliers request only',()=>{
    expect(()=>buildCountryEvidencePlan({...input,hs_code:'0901'})).toThrow(/HS6/);
    expect(()=>buildCountryEvidencePlan({...input,hs_revision:'unknown'})).toThrow(/revision/);
    expect(()=>buildCountryEvidencePlan({...input,source_mode:'preview'})).toThrow(/Preview/);
    expect(canonicalComtradeRequest({provider:'un_comtrade',dataset:'goods-trade',source_mode:'authenticated',purpose:'country_truth',reporter_code:'276',partner_code:'all',partner2_code:'0',flow_direction:'import',frequency:'A',period:'2025',hs_codes:['090111'],hs_revision:'HS2022',customs_code:'C00',mode_of_supply:'0'}).partner_code).toBe('all');
  });
});
