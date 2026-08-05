# 12 — Appendix: Screen Registry, Routes & Glossary

Source: PRD Part 11.

---

## A. Screen registry

**32 screens total** — 17 exporter, 8 agent, 7 ops. 21 are P0.

### Exporter Portal (`/app/*`)

| ID | Screen | Route | Pri |
|---|---|---|---|
| EXP-01 | Dashboard / Overview | `/app/overview` | P0 |
| EXP-02 | Onboarding & Export Readiness | `/app/readiness` | P0 |
| EXP-03 | Enablement Center | `/app/readiness/tasks` | P1 |
| EXP-04 | Demand Discovery — Runs & Ranked Markets | `/app/markets` | P0 |
| EXP-05 | Market Detail | `/app/markets/:marketAssessmentId` | P0 |
| EXP-06 | Buyer Discovery — Search & Shortlist | `/app/buyers` | P0 |
| EXP-07 | Buyer Detail | `/app/buyers/:buyerId` | P0 |
| EXP-08 | Deals List | `/app/deals` | P0 |
| EXP-09 | Deal Workspace — Overview | `/app/deals/:dealId` | P0 |
| EXP-10 | Deal — Commercial Terms & Negotiation | `/app/deals/:dealId/commercial` | P0 |
| EXP-11 | Deal — Tasks | `/app/deals/:dealId/tasks` | P0 |
| EXP-12 | Document Center — Deal Documents | `/app/deals/:dealId/documents` | P0 |
| EXP-13 | Document Detail / Review | `/app/deals/:dealId/documents/:documentId` | P0 |
| EXP-14 | Shipment & CHA Tracking | `/app/deals/:dealId/shipment` | P0 |
| EXP-15 | Payment, Banking Visibility & Insurance | `/app/deals/:dealId/payment` | P1 |
| EXP-16 | Messages, Support & Disputes | `/app/deals/:dealId/support` | P1 |
| EXP-17 | Notifications & Account | `/app/notifications` | P1 |

### Agent Portal (`/agent/*`)

| ID | Screen | Route | Pri |
|---|---|---|---|
| AGT-01 | My Day / Command Center | `/agent` | P0 |
| AGT-02 | Exporter 360 | `/agent/exporters/:exporterOrgId` | P0 |
| AGT-03 | Outreach CRM / Buyer Pipeline | `/agent/outreach` | P0 |
| AGT-04 | Lead / Buyer Workspace | `/agent/leads/:buyerLeadId` | P0 |
| AGT-05 | Negotiation & Deal Conversion | `/agent/deals/:dealId/commercial` | P0 |
| AGT-06 | Deal Execution Workspace | `/agent/deals/:dealId` | P0 |
| AGT-07 | Tasks, SLAs & Escalations | `/agent/tasks` | P0 |
| AGT-08 | Agent Performance & Payout | `/agent/performance` | P1 |

### Ops / Admin Console (`/ops/*`)

| ID | Screen | Route | Pri |
|---|---|---|---|
| OPS-01 | Operations Control Tower | `/ops` | P0 |
| OPS-02 | Assignments & Agent Capacity | `/ops/assignments` | P0 |
| OPS-03 | Exceptions & Escalations Queue | `/ops/exceptions` | P0 |
| OPS-04 | CHA, Compliance & Document Oversight | `/ops/execution` | P1 |
| OPS-05 | Finance, Fees & Agent Payouts | `/ops/finance` | P1 |
| OPS-06 | Dispute Oversight | `/ops/disputes` | P1 |
| OPS-07 | Audit Log & Admin Configuration | `/ops/audit` | P1 |

---

## B. Route conventions

- `/app/*` = exporter routes · `/agent/*` = agent routes · `/ops/*` = operations/admin routes.
- Use **canonical resource IDs** in URLs for details. **Do not embed sensitive data, names or email
  addresses in routes.**
- Nested deal routes preserve deal context:
  `/app/deals/:dealId/documents/:documentId`, `/agent/deals/:dealId/commercial`, etc.
- Where tabs map to meaningful navigable state, use a **route/subroute rather than ephemeral
  client-only tab state**, so deep links work.

Note the deliberate symmetry: `/app/deals/:dealId` and `/agent/deals/:dealId` are the **same deal**
rendered with different permissions and density — not two different records. This is the shared-object
architecture expressed in the URL structure.

---

## C. Glossary

Domain terms that engineers unfamiliar with Indian export operations will need.

| Term | Definition |
|---|---|
| **AD code** | Bank-related Authorized Dealer code/registration used in the export customs context. The UI should model **status and evidence**, not oversimplify to a text field |
| **CHA** | Customs House Agent / customs broker — coordinates customs filing and clearance tasks |
| **BRC** | Bank Realisation Certificate — realization evidence/milestone in the export process. Tracked **independently** of payment received/realized status |
| **ICEGATE** | Indian customs electronic gateway used for customs trade filing/interaction. ClearTrade may prepare/coordinate but **not necessarily file directly** |
| **Incoterm** | Standard trade term allocating costs/risks/responsibilities (FOB, CIF, etc.); pair with the named place where relevant |
| **HS code** | Harmonized System product classification code used in trade data/compliance |
| **IEC** | Importer Exporter Code — required registration for Indian exporters (modeled as a status-aware field: `unknown`/`not_started`/`pending`/`verified`) |
| **GSTIN** | Goods and Services Tax Identification Number |
| **Readiness** | ClearTrade's assessment of whether an exporter/product is operationally prepared for the target export workflow |
| **Lead** | An exporter–product–buyer relationship actively being worked |
| **Deal lock** | The workflow milestone when required commercial terms/approvals are sufficiently complete to enter execution. Freezes the Deal Snapshot |
| **Exception** | An operational issue requiring an owner and remediation — **not necessarily** a formal dispute |
| **Dispute** | A structured case for a substantive payment, quality, logistics, document or other conflict |
| **SLA** | Operational response/completion target used internally to prioritize work |
| **PI** | Proforma Invoice |
| **CI** | Commercial Invoice |
| **COO** | Certificate of Origin |
| **MOQ** | Minimum Order Quantity |
| **LC / TT** | Letter of Credit / Telegraphic Transfer — payment methods |
| **AA** | Account Aggregator — a source type for payment status data |

---

## D. Final definition of done

> ### The implementation is complete only when the workflow is complete
>
> A screen that looks correct but does not create/update the canonical object, notify the next
> owner, preserve history, enforce permissions, handle failure states and appear correctly in the
> other relevant portal **is not done**.

- Visual implementation matches the companion UI Blueprint and uses **one reusable design system**.
- All P0 screens are implemented with loading, empty, error, permission and mobile states.
- All material state transitions are **server-validated and audited**.
- Demand Discovery, Buyer Discovery and Document Generation are integrated through durable UI
  contracts and async job states.
- Exporter, Agent and Ops see consistent shared state with role-appropriate detail and **no data
  leakage**.
- Cross-portal integration tests and UAT pass in staging with realistic
  exporter/deal/document/shipment/payment scenarios.
- Production observability, permissions, file security and configuration are verified before launch.

### Blueprint's definition of success (user-facing view)

- An exporter can understand their exact next step in **under 10 seconds**.
- An agent can manage assigned exporters **without an external spreadsheet/task tracker**.
- Ops can identify every blocked deal and its owner **from one screen**.
- Every important document, approval and commercial change is **auditable**.
- A repeat exporter can start the next shipment with **most data prefilled**.
