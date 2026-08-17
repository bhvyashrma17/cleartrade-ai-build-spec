import { describe, expect, test } from 'vitest';
import { ApprovalStatus, DealStage, DisputeStatus, FilingStatus, GenerationStatus, PaymentSource, PaymentStatus, ReviewStatus, ShipmentStatus, TaskState } from '@prisma/client';
import { assertDealTransition } from '../src/lib/state-machines/deal';
import { assertTaskTransition } from '../src/lib/state-machines/task';
import { assertShipmentTransition } from '../src/lib/state-machines/shipment';
import { assertPaymentTransition } from '../src/lib/state-machines/payment';
import { assertDisputeTransition } from '../src/lib/state-machines/dispute';
import { freshVersionStatuses } from '../src/lib/documents';

describe('workflow invariants',()=>{
  test('deal cannot skip stages, close without reason, or lock without server context',()=>{
    expect(()=>assertDealTransition(DealStage.qualifying,DealStage.deal_locked)).toThrow();
    expect(()=>assertDealTransition(DealStage.qualifying,DealStage.closed_lost)).toThrow(/reason/i);
    expect(()=>assertDealTransition(DealStage.terms_agreed,DealStage.deal_locked)).toThrow();
  });

  test('locked deal cancellation requires controlled authorization and reason',()=>{
    expect(()=>assertDealTransition(DealStage.deal_locked,DealStage.cancelled,{closed_reason:'buyer withdrew'})).toThrow(/Ops|authorized/i);
    expect(assertDealTransition(DealStage.deal_locked,DealStage.cancelled,{closed_reason:'buyer withdrew',controlled_cancel_authorized:true}).audit).toBe(true);
  });

  test('task waiting, cancellation, and domain completion retain their invariants',()=>{
    expect(()=>assertTaskTransition(TaskState.in_progress,TaskState.waiting,{blocked_reason:'bank'})).toThrow(/waiting on|party/i);
    expect(()=>assertTaskTransition(TaskState.in_progress,TaskState.cancelled)).toThrow(/reason/i);
    expect(()=>assertTaskTransition(TaskState.in_progress,TaskState.done,{domain_prerequisite_met:false})).toThrow(/action|succeeds/i);
  });

  test('new document versions reset generation, review, approval, and filing independently',()=>{
    expect(freshVersionStatuses(true,true)).toEqual({generation_status:GenerationStatus.queued,review_status:ReviewStatus.not_reviewed,approval_status:ApprovalStatus.pending,filing_status:FilingStatus.draft});
    expect(freshVersionStatuses(false,false)).toEqual({generation_status:GenerationStatus.queued,review_status:ReviewStatus.not_reviewed,approval_status:ApprovalStatus.not_required,filing_status:FilingStatus.not_applicable});
  });

  test('shipment exceptions require reasons and cannot resume without resolution',()=>{
    expect(()=>assertShipmentTransition(ShipmentStatus.in_transit,ShipmentStatus.exception)).toThrow(/reason/i);
    expect(()=>assertShipmentTransition(ShipmentStatus.exception,ShipmentStatus.customs)).toThrow(/resolution/i);
    expect(()=>assertShipmentTransition(ShipmentStatus.delivered,ShipmentStatus.in_transit)).toThrow();
  });

  test('payment movement requires provenance and amount semantics',()=>{
    expect(()=>assertPaymentTransition(PaymentStatus.due,PaymentStatus.received,{amount_received:100,amount:100})).toThrow(/Provenance/i);
    expect(()=>assertPaymentTransition(PaymentStatus.due,PaymentStatus.partially_received,{source:PaymentSource.exporter_update,amount_received:100,amount:100})).toThrow(/not a partial/i);
    expect(assertPaymentTransition(PaymentStatus.due,PaymentStatus.received,{source:PaymentSource.exporter_update,amount_received:100,amount:100}).set_received_at).toBe(true);
  });

  test('dispute investigation, waiting, resolution, and closure require durable facts',()=>{
    expect(()=>assertDisputeTransition(DisputeStatus.open,DisputeStatus.investigating)).toThrow(/owner/i);
    expect(()=>assertDisputeTransition(DisputeStatus.investigating,DisputeStatus.waiting_external,{waiting_on:'bank'})).toThrow(/follow-up/i);
    expect(()=>assertDisputeTransition(DisputeStatus.proposed_resolution,DisputeStatus.resolved)).toThrow(/acceptance|authority/i);
    expect(()=>assertDisputeTransition(DisputeStatus.resolved,DisputeStatus.closed)).toThrow(/summary/i);
  });
});
