import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { DerivedDataPolicy, EvidenceOrigin, OrgTier, RawRetentionPolicy, TradeDataSource, UserRole } from '@prisma/client';
import { assertImportRecordUse, assertRightsGrantValid, enforceImportRecordRetention, ImportRecordRightsError } from '../src/lib/import-record-rights';
import { encryptRawIdentity, readRawImportIdentity } from '../src/lib/import-identity';
import { runCbpManifestIngest } from '../src/lib/job-handlers/cbp-manifest';
import { prisma } from '../src/lib/prisma';

const rights=(overrides:Partial<{allowed_to_display:boolean;allowed_to_export:boolean;allowed_to_cache:boolean;retention_limit:Date|null}>={})=>({allowed_to_display:false,allowed_to_export:false,allowed_to_cache:false,retention_limit:null,...overrides});
afterAll(()=>prisma.$disconnect());

describe('licensed ImportRecord use',()=>{
  test.each(['display','export','cache'] as const)('%s restriction is enforced',use=>expect(()=>assertImportRecordUse(rights(),use)).toThrow(ImportRecordRightsError));
  test.each(['display','export','cache'] as const)('%s permission works when explicitly granted',use=>expect(()=>assertImportRecordUse(rights({allowed_to_display:use==='display',allowed_to_export:use==='export',allowed_to_cache:use==='cache'}),use)).not.toThrow());
  test('retention expiry overrides otherwise granted rights',()=>expect(()=>assertImportRecordUse(rights({allowed_to_cache:true,retention_limit:new Date('2020-01-01')}),'cache',new Date('2021-01-01'))).toThrow(/expired/));
  test('invalid or expired normalized rights fail closed',()=>{
    const base={effective_at:null,expires_at:null,allowed_to_cache:true,raw_retention_policy:RawRetentionPolicy.delete_at_expiry,derived_data_policy:DerivedDataPolicy.retain_pseudonymous};
    expect(()=>assertRightsGrantValid({...base,derived_data_policy:DerivedDataPolicy.unspecified})).toThrow(/explicit/);
    expect(()=>assertRightsGrantValid({...base,expires_at:new Date('2020-01-01')},new Date('2021-01-01'))).toThrow(/expired/);
  });

  test('consignee names require the buyer-reference secret',async()=>{
    const previous=process.env.IMPORT_BUYER_REF_SECRET;delete process.env.IMPORT_BUYER_REF_SECRET;
    const outcome=await runCbpManifestIngest({job_id:randomUUID(),attempt_no:1,payload:{file_path:path.resolve('tests/fixtures/cbp-manifest/records.ndjson'),license_file_path:path.resolve('tests/fixtures/cbp-manifest/license.json'),evidence_origin:'fixture'},exporter_org_id:null,target_id:null,correlation_id:randomUUID(),reportProgress:async()=>{}});
    try{expect(outcome.status).toBe('failed');expect(JSON.stringify(outcome.result)).toMatch(/IMPORT_BUYER_REF_SECRET/);}
    finally{const runId=(outcome.result as {ingest_run_id:string}).ingest_run_id;await prisma.ingestRun.delete({where:{id:runId}});if(previous===undefined)delete process.env.IMPORT_BUYER_REF_SECRET;else process.env.IMPORT_BUYER_REF_SECRET=previous;}
  });

  test('raw access is privileged, tenant-safe, and audited without copying PII into the event',async()=>{
    process.env.IMPORT_RAW_IDENTITY_ENCRYPTION_KEY=Buffer.alloc(32,3).toString('base64');
    const org=await prisma.exporterOrg.create({data:{display_name:`rights-${randomUUID()}`,tier:OrgTier.paid}});
    const admin=await prisma.user.create({data:{email:`admin-${randomUUID()}@example.invalid`,name:'Admin',role:UserRole.admin}});
    const grant=await prisma.sourceRightsGrant.create({data:{provider:'test',delivery_batch_id:randomUUID(),license_type:'test assertion',allowed_to_display:false,allowed_to_export:false,allowed_to_cache:true,raw_retention_policy:RawRetentionPolicy.delete_at_expiry,derived_data_policy:DerivedDataPolicy.retain_pseudonymous,evidence_checksum:randomUUID()}});
    const encrypted=encryptRawIdentity('RESTRICTED CONSIGNEE LLC');
    const record=await prisma.importRecord.create({data:{buyer_ref:'v1:test',buyer_ref_key_version:'v1',country:'US',shipment_date:new Date(),source:TradeDataSource.cbp_vessel_manifest,source_record_id:`raw-${randomUUID()}`,retrieved_at:new Date(),evidence_origin:EvidenceOrigin.fixture,source_provider:'test',license_type:'test assertion',allowed_to_display:false,allowed_to_export:false,allowed_to_cache:true,personal_data_flag:true,rights_grant_id:grant.id,raw_identity:{create:encrypted}}});
    const exporter={id:'not-persisted',email:'x@example.invalid',name:'Exporter',role:UserRole.exporter_owner,exporter_org_id:org.id,tier:OrgTier.paid};
    await expect(readRawImportIdentity({importRecordId:record.id,principal:exporter,reason:'Trying to cross tenant scope'})).rejects.toThrow(/restricted/);
    expect(await prisma.rawDataAccessEvent.count({where:{import_record_id:record.id}})).toBe(0);
    const value=await readRawImportIdentity({importRecordId:record.id,principal:{id:admin.id,email:admin.email,name:admin.name,role:admin.role,exporter_org_id:null,tier:OrgTier.paid},reason:'Investigate a documented rights request'});
    expect(value).toBe('RESTRICTED CONSIGNEE LLC');
    const event=await prisma.rawDataAccessEvent.findFirstOrThrow({where:{import_record_id:record.id}});
    expect(event).toMatchObject({actor_user_id:admin.id,action:'privileged_read'});expect(JSON.stringify(event)).not.toContain('RESTRICTED CONSIGNEE');
  });

  test('retention dry-run is non-destructive; purge removes raw while preserving permitted derived data',async()=>{
    process.env.IMPORT_RAW_IDENTITY_ENCRYPTION_KEY=Buffer.alloc(32,4).toString('base64');
    const grant=await prisma.sourceRightsGrant.create({data:{provider:'retention-test',delivery_batch_id:randomUUID(),license_type:'test assertion',expires_at:new Date('2020-01-01'),allowed_to_display:true,allowed_to_export:true,allowed_to_cache:true,raw_retention_policy:RawRetentionPolicy.delete_at_expiry,derived_data_policy:DerivedDataPolicy.retain_pseudonymous,evidence_checksum:randomUUID()}});
    const buyer=await prisma.buyer.create({data:{legal_name:'Pseudonymous buyer',display_name:'Pseudonymous buyer',country_code:'US',buyer_type:'importer'}});
    await prisma.buyerFeatureSnapshot.create({data:{buyer_id:buyer.id,shipment_count_12m:1,origin_mix:{},provenance:{source:'licensed-derived'}}});
    const record=await prisma.importRecord.create({data:{buyer_ref:'v1:retention',buyer_ref_key_version:'v1',buyer_id:buyer.id,country:'US',shipment_date:new Date('2019-01-01'),source:TradeDataSource.cbp_vessel_manifest,source_record_id:`retention-${randomUUID()}`,retrieved_at:new Date('2019-01-02'),evidence_origin:EvidenceOrigin.fixture,source_provider:'retention-test',license_type:'test assertion',allowed_to_display:true,allowed_to_export:true,allowed_to_cache:true,retention_limit:new Date('2020-01-01'),personal_data_flag:true,rights_grant_id:grant.id,raw_identity:{create:encryptRawIdentity('EXPIRED RAW NAME')}}});
    expect((await enforceImportRecordRetention({now:new Date('2021-01-01'),dryRun:true})).considered).toBeGreaterThan(0);
    expect(await prisma.rawImportIdentity.findUnique({where:{import_record_id:record.id}})).not.toBeNull();
    await enforceImportRecordRetention({now:new Date('2021-01-01'),dryRun:false});
    const retained=await prisma.importRecord.findUniqueOrThrow({where:{id:record.id}});
    expect(retained).toMatchObject({allowed_to_display:false,allowed_to_export:false,allowed_to_cache:false});
    expect(await prisma.rawImportIdentity.findUnique({where:{import_record_id:record.id}})).toBeNull();
    expect(await prisma.buyerFeatureSnapshot.findUnique({where:{buyer_id:buyer.id}})).not.toBeNull();
    expect(await prisma.importRetentionEvent.count({where:{import_record_id:record.id}})).toBe(2);
  });
});

async function files(root:string):Promise<string[]>{const entries=await readdir(root,{withFileTypes:true});return (await Promise.all(entries.map(entry=>entry.isDirectory()?files(path.join(root,entry.name)):[path.join(root,entry.name)]))).flat();}
describe('raw warehouse route boundary',()=>{
  test('no API route reads TradeFlow or ImportRecord',async()=>{
    const routeFiles=(await files(path.resolve('src/app/api'))).filter(file=>/\.(ts|tsx)$/.test(file));
    const contents=await Promise.all(routeFiles.map(file=>readFile(file,'utf8')));
    expect(contents.filter(text=>/prisma\.tradeFlow\b/.test(text))).toHaveLength(0);
    expect(contents.filter(text=>/prisma\.importRecord\b/.test(text))).toHaveLength(0);
  });
});
