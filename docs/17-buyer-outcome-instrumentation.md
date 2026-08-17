# Buyer outcome instrumentation

From the first real BuyerLead, ClearTrade now retains the context that was true when the buyer was surfaced, independently of later model changes.

`BuyerLeadSnapshot` freezes the exporter, product, destination, buyer, fit assessment/model/components/confidence, rank, relevant market assessment, sanctions result/version, evidence coverage, and only the commercial facts known at creation. Missing facts remain null. Product certification claims are copied with their status and evidence; they are not inferred.

`OutreachAttempt` records every contact attempt with channel, actor, time, sequence, optional template/version, manual or automated origin, delivery state, and optional structured reply classification plus notes. No response is calculated from elapsed attempts without a reply; it is not fabricated as a reply event.

`BuyerLeadTransition` is append-only history behind the current `BuyerLead.stage` projection. Creation, outreach-driven stage changes, disqualification, and conversion retain actor and time. Conversion links `BuyerOutcome` to the canonical Deal.

Payment feedback is derived from canonical Payment milestones and their provenance. Agents cannot enter a free-standing payment-reliability claim. The evidence snapshot supports reply and conversion rates, time-to-event metrics, rejection distributions, fit calibration, buyer/product/exporter compatibility, agent effects, and payment outcomes without recalculating old leads.

Rows retain `evidence_origin`; fixture outcomes remain excluded by the existing real-learning evidence predicate.
