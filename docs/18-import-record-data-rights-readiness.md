# ImportRecord data-rights readiness

## Engineering boundary

New manifest ingest stores a versioned HMAC buyer reference on `ImportRecord`. The source consignee value is encrypted with AES-256-GCM in the separate `RawImportIdentity` table; routine queries and buyer search do not select it. Canonical `Buyer` names created from manifests are pseudonymous, and `BuyerAttributeClaim` retains the pseudonymous source reference rather than another copy of the consignee name.

Raw identity can be read only through the privileged service. It permits Admin and Ops Supervisor principals, requires a reason, and writes `RawDataAccessEvent` without the raw value. System entity-resolution and sanctions-screening reads are also reasoned and audited. No API route returns `ImportRecord` or `RawImportIdentity`.

The buyer-reference secret and encryption key are separate and versioned. Rotation deploys a new active version while retaining old secrets/keys in the previous-version key rings. Re-keying or reference migration must complete before old material is removed. Secrets must come from the deployment secret manager and must never enter logs or database rows.

## Rights and retention

`SourceRightsGrant` links each row to a delivery/batch, provider, licence/contract reference, effective/expiry dates, use flags, raw-retention policy, derived-data policy, evidence reference/checksum, and an honest verification method. `operator_asserted` is not represented as provider or cryptographic verification. Real workflows reject missing, expired, not-yet-effective, prohibited, or unspecified derived-data rights.

The scheduled `import_record_retention` job supports dry runs. Expired rows immediately lose display, export, cache, and operational eligibility. It deletes encrypted raw identity according to raw policy. A record is deleted only when the configured derived-data policy is `prohibited`; otherwise pseudonymous/aggregate derivatives are preserved and the decision is recorded in `ImportRetentionEvent`. This is policy execution, not a legal interpretation.

Existing rows lacked linked evidence. Migration classifies them as `legacy_unverified`, disables all use, redacts plaintext ImportRecord identity, pseudonymizes linked manifest Buyer names, and redacts legacy name claims. It does not relabel them as real or reviewed.

## Field minimization rationale

- `buyer_ref`: pseudonymous entity linkage and rotation-safe matching.
- restricted raw consignee identity: entity resolution, sanctions review, and documented rights requests only.
- `hs_code`, shipment date, origin, port, quantity/unit, value/currency: shipment behavior and contextual buyer-fit evidence.
- `shipper_name`: supplier concentration and India-sourcing history; it remains source-sensitive and is never exposed as a contact.
- source ID, provider, retrieval time, ingest run, evidence origin, rights grant: lineage, idempotency, audit, and enforcement.
- canonical buyer linkage and resolution confidence/method: explainable entity resolution.

No field is contact enrichment, and vessel manifests remain incomplete due to transport-mode scope and source confidentiality.

## Legal/policy work still required

Engineering controls do not establish that CBP data may be displayed, exported, cached, or used for a particular pilot. Counsel or an authorized rights owner must approve each delivery's licence interpretation, raw and derived retention policies, data-subject handling, jurisdictional requirements, and whether specific derived features may survive raw expiry. The deletion-request workflow records review and audit history but deliberately does not make automatic legal determinations.
