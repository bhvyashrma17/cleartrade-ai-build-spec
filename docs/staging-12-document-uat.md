# ClearTrade 12-document staging UAT

This runbook uses only the deterministic `[PILOT]` fixtures and the reserved `pilot.invalid`
accounts. The values are test fixtures, not claims about a real exporter, shipment, carrier,
bank, or payment.

## Fixture contract

Alpha is a containerised sea shipment on Documents against Payment (`DP`). Its canonical
shipment has a freight partner, booking reference, freight terms and one Method 2 VGM whose
component mass plus tare equals the verified gross mass. Its trade-finance instruction selects
a due payment, a tenant-owned bank account, a sight bill and two document enclosures. No invoice
number, document snapshot, artifact, review, approval or AgentDecision is pre-created.

Bravo is also a containerised sea / DP shipment, but deliberately retains:

- no AD code (shipping-bill-specific);
- incomplete buyer and discharge-port data (shared blockers are visible honestly);
- a real container with no verified gross mass, method, verification timestamp or verifier
  (VGM-specific; package totals must not satisfy it);
- no collection instructions (bank-cover-letter-specific; it is not a Bill of Exchange input).

Charlie remains the populated exporter assigned to a different agent. This change does not add
document-UAT canonical facts or assignments to Charlie.

Bravo also has a separate, clearly labelled air/Advance applicability-control deal. On that
deal, VGM, Bill of Exchange and bank presentation are truthfully not applicable. It exists so
the test does not have to mutate the blocked sea fixture into a logically contradictory state.

## Exact manual flow

Use the deal IDs printed by `staging-pilot.ts seed` below. Replace `<ALPHA_DEAL_ID>`,
`<BRAVO_DEAL_ID>` and `<BRAVO_NA_DEAL_ID>` literally; do not guess IDs.

1. Sign in as the Agent assigned to Alpha and open
   `/agent/deals/<ALPHA_DEAL_ID>/document-data`.
2. Confirm all 12 rows appear. Confirm Shipping Instructions, VGM Declaration, Bill of Lading
   Instructions, Bill of Exchange and Bank Document Presentation / Collection Cover Letter are
   applicable. CI, Bill of Exchange and the bank letter should initially identify the absent
   official invoice number; the remaining new Alpha types should be ready.
3. In **Commercial data → Commercial Invoice**, issue the official CI number once. Confirm the
   preview was not presented as issued before this action.
4. Return to `/agent/deals/<ALPHA_DEAL_ID>/documents`. Generate the Commercial Invoice in PDF,
   DOCX and Preview (HTML).
5. Generate Shipping Instructions in PDF, DOCX and Preview.
6. Generate VGM Declaration in PDF, DOCX and Preview. Confirm its table uses the recorded
   container VGM and does not substitute the package total.
7. Generate Carrier Instructions in all three formats. Confirm the visible title is **Bill of
   Lading Instructions**, never an issued Bill of Lading.
8. Generate Bill of Exchange in all three formats. Confirm it says sight/payable wording from
   the canonical instruction and does not claim drawee acceptance or payment.
9. Generate Bank Document Presentation / Collection Cover Letter in all three formats. Confirm
   bank/branch, collection terms and the CI/packing-list enclosure rows are present and it does
   not claim bank acceptance, negotiation or realization.
10. Compare PDF, DOCX and HTML for each frozen version: title/variant, parties, values, dates,
    currency, units, authority wording, draft status, audit reference and integrity hash must
    agree. Layout may differ by format; binary or pixel equality is not expected.
11. As Agent, open each generated version and complete Agent review. Confirm review is distinct
    from generation and approval.
12. Sign in as `exporter-a@pilot.invalid` and approve each of the five new versions (and CI if
    included in this pass). Confirm approval wording does not imply carrier issuance, drawee
    acceptance, bank acceptance or insurer action.
13. As Agent, change exactly one canonical fact consumed by one tested document—for example the
    shipment handling instruction—through Document Data. Do not edit an artifact or snapshot.
14. Open the affected version and confirm canonical-data drift is reported while v1 remains
    downloadable with its original checksum.
15. Create an amendment with a specific reason, then generate v2 in PDF, DOCX and HTML.
16. Confirm v1 remains superseded but immutable, v2 has a new snapshot/content checksum, and only
    the intended canonical value changed.
17. Open `/agent/deals/<BRAVO_DEAL_ID>/document-data`. Confirm VGM is blocked specifically by
    unverified per-container facts, the missing collection instruction appears only on the bank
    letter, the AD-code blocker affects the shipping bill, and package mass is never presented as
    verified VGM. Then open `/agent/deals/<BRAVO_NA_DEAL_ID>/documents`: confirm the air variant is
    **Air Waybill Instructions**, while VGM, Bill of Exchange and bank presentation are **Not
    applicable**, not blocked. Do not change the primary Bravo deal to manufacture this state.
18. While still signed in as Alpha/Bravo's Agent, copy Charlie's deal ID from the seed operator
    output or database operator and request `/agent/deals/<CHARLIE_DEAL_ID>/documents` and
    `/agent/deals/<CHARLIE_DEAL_ID>/document-data`. Both must return the product's scoped 404/access
    denial behavior; Charlie's data must not render.

## Expected lifecycle and artifacts

The five new document types require Agent review followed by exporter approval. Approval means
the exporter authorises the declaration/instruction version only. It never means carrier-issued,
drawee-accepted, bank-accepted, paid, negotiated or realised. CI also requires exporter approval.
Insurance Declaration remains the only registry document with exporter approval not required.

Generating CI plus the five new types in all three formats creates 18 artifacts: six PDFs, six
DOCX files and six HTML previews. Each artifact is bound to its document version, frozen input
snapshot and checksum. Generating all three formats for one amendment adds three v2 artifacts;
the corresponding v1 artifacts remain stored and downloadable.

## Local verification

```bash
npx prisma validate
npx vitest run tests/document-capability-foundation.test.ts tests/document-data.test.ts tests/document-rendering.test.ts tests/document-lifecycle.test.ts tests/document-money.test.ts tests/document-storage.test.ts tests/staging-pilot-documents.test.ts
npm test
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

## Staging deployment and seed order

The linked Railway project is `c99f8829-5056-4980-86e0-17083d67a6d8`; staging is
`e3e9bdae-38a4-4f8f-a85e-d49f295ee69f`; the application service is
`a14fb741-778e-4443-9aec-e58b7ae83164`. Do not target the production environment.

1. Deploy the reviewed commit to the application service. Its checked-in Railway configuration
   runs `npx prisma migrate deploy` as the pre-deploy command, so schema/backfill migrations run
   before the new application starts:

   ```bash
   railway up --project c99f8829-5056-4980-86e0-17083d67a6d8 --environment e3e9bdae-38a4-4f8f-a85e-d49f295ee69f --service a14fb741-778e-4443-9aec-e58b7ae83164 --detach -m "Expand staging pilot to 12-document UAT"
   railway deployment list --project c99f8829-5056-4980-86e0-17083d67a6d8 --environment e3e9bdae-38a4-4f8f-a85e-d49f295ee69f --service a14fb741-778e-4443-9aec-e58b7ae83164 --limit 5 --json
   ```

   Do not continue until the newest deployment status is `SUCCESS` and `/api/health/ready`
   succeeds. `--detach` reporting a queued build is not deployment success.

2. Inspect the fixture before writing:

   ```bash
   railway run --project c99f8829-5056-4980-86e0-17083d67a6d8 --environment e3e9bdae-38a4-4f8f-a85e-d49f295ee69f --service a14fb741-778e-4443-9aec-e58b7ae83164 -- npx tsx scripts/staging-pilot.ts status
   ```

3. On a clean pilot only, seed using a test-only password supplied from the operator's shell:

   ```bash
   PILOT_PASSWORD='<10+ character test-only password>' railway run --project c99f8829-5056-4980-86e0-17083d67a6d8 --environment e3e9bdae-38a4-4f8f-a85e-d49f295ee69f --service a14fb741-778e-4443-9aec-e58b7ae83164 -- npx tsx scripts/staging-pilot.ts seed
   ```

   The seed prints Alpha, Bravo and Charlie deal IDs but never prints the password. If pilot users
   already exist, the seed refuses rather than merging fixtures. `reset` is allowed only when the
   fixture has no append-only issued invoice number; never delete or rewrite an issued number to
   force a reset.

4. Use the real staff-invitation/assignment flow to assign the UAT Agent to Alpha and Bravo, then
   follow the 18 manual steps above. Do not seed reviews, approvals, artifacts or AgentDecisions.
