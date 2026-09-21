# Malaysia Customs Atlas — local implementation, rights pending

Status: `LOCAL_IMPLEMENTATION_READY_RIGHTS_PENDING`

Rights gate: `COMMERCIAL_REUSE_PERMISSION_PENDING`

Reference date: 21 September 2026

The executable tariff authority is Royal Malaysian Customs Department (JKDM), Customs Duties
Order 2025, P.U. (A) 384/2025, effective 1 November 2025. JKDM's current customs-order registry
lists that principal order without an MFN amendment. The implementation reads First Schedule
column (5) as import duty and never substitutes column (6), export duty. The separate flat-rate
rule for passenger baggage/non-commercial consignments is explicitly excluded from commercial
export results.

The qualified official PDF has 1,466 pages, SHA-256
`e51c740cf95290cb71cd473596adc21ef159d1aa4f2a0282c73b4b3815beea99`, 11,441 unique
ten-digit First Schedule lines, and 27 Appendix B TRQ lines. The parser preserves published units,
ad-valorem, specific, compound/mixed, express zero, blank, and TRQ semantics. Blank is never zero;
specific or compound duty is never converted to an AVE. TRQ rows retain separate in-quota and
out-of-quota rates, quota agency, and an unresolved availability/evidence requirement.

MICECA is retained as an existing preference that requires origin proof. The reviewed official
material did not establish a current HS 2022/P.U. (A) 384/2025 line mapping from the historical
P.U. (A) 215/2011 schedule, so the implementation reports potential applicability with no guessed
line rate. Sales tax is a separate, partially modelled MySST layer, including the 2025 principal
orders and July/August 2026 amendment chain; it is never folded into customs duty. Active trade
remedies are held in a dated, checksummed manifest covering nine active instrument chains and 20
origin schedules. Principal orders and applicable amendments have separate official-source
checksums; producer-specific rates require an exact producer/exporter identity, nil rates are
preserved, and excluded producers never inherit a catch-all rate. Regulatory coverage remains
false.

## Hard rights gate

JKDM's published safety/copyright notice requires clear prior written permission for commercial
copying, distribution or use of its website content. data.gov.my's CC BY 4.0 terms apply only to
datasets actually published there; no evidence was found that this exact tariff dataset is one of
them. Therefore the code permits transient local acquisition and validation only. It refuses
retention/import and activation, is absent from destination routing and the staging queue, and no
authority PDF or normalized tariff cache is committed to this repository.

Activation unlocks only when one of these exact evidentiary paths is satisfied:

1. written JKDM permission expressly authorizes ClearTrade to periodically acquire, retain,
   normalize, transform, redistribute and commercially display the P.U. (A) 384/2025 tariff and
   updates; or
2. JKDM/data.gov.my publishes that exact dataset under terms expressly granting those rights.

After that evidence is independently reviewed, a fresh currentness, checksum, deterministic replay,
trade-remedy completeness and real-release qualification must pass before staging or routing.

Official references:

- https://www.customs.gov.my/images/06-prosedur/perintah-kastam/perintah/PUA_384.pdf
- https://www.customs.gov.my/en/procedure/customs/customs
- https://mycieds.customs.gov.my/safety-policy/
- https://fta.miti.gov.my/index.php/pages/view/Malaysia-India
- https://mysst.customs.gov.my/sst-orders/
