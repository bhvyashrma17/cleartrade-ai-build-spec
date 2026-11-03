# EU TARIC monthly extraction — verified schema map

Written from the **real September 2026 bundle**, not from the guide alone. Every column position
and every semantic below was confirmed by reading the actual files. Guide: *Explanations for the
TARIC database extractions*, Rev. 11, 9 June 2026 (European Commission, DG TAXUD).

Bundle SHA-256 `3326296a417c8f8c8544b8d45d6a73b978618d20d90f085e6b26a99ae2553880`, 17 xlsx files.
Every sheet is named `Export Worksheet`; row 1 is the header; dates are strings `DD-MM-YYYY`.

## The four semantics that decide correctness

**1. The reference date is not "now", and the extraction contains the future.**
Guide, p.2: the extraction reflects the database *"with a reference date on the first day of the
month"* and contains *"all applicable data on the reference day **and all data applicable after
that day**"*. So the file legitimately contains measures that are not yet in force. Every measure
and every group membership must be filtered against the assessment clock, or ClearTrade would
quote a duty that does not apply yet.

**2. The cascade — measures are inherited from ancestor goods codes.**
Guide, §14.1.4: *"not all the goods codes and their respective TARIC measures are listed in these
tables… if this goods code possesses child-codes, they will automatically inherit the applicable
measures of its parent-codes."* Verified: `1006302712` (Basmati) has **zero** measure rows of its
own. Its third-country duty sits on `1006300000` and its import controls on `1006000000`. A join
on the exact 10-digit code finds nothing. Ancestors are the zero-padded prefixes at 8/6/4/2
digits.

**3. Group membership is necessary but not sufficient — exclusions override it.**
Guide §9.1: excluded countries *"are not included in the files Duties Import and Duties Export"*,
so the exclusion is only discoverable by joining `Measure exclusions`. Verified live: India is a
member of group `1008` (All third countries), and group 1008 carries quota `094119` on
`1006300000` — **but India is explicitly excluded from precisely that measure**. Matching on
membership alone would apply a quota to India that the Commission excluded India from.

**4. The product line suffix is structure, not identity.**
A goods code appears several times with suffixes `10`/`20`/`80`. Suffix ≠ 80 is an intermediary
heading; suffix 80 is actual goods. Verified on Basmati:

| Row | Description | Role |
| --- | --- | --- |
| `1006302712 10` | In immediate packings of a net content not exceeding 5 kg | ancestry |
| `1006302712 20` | Aromatic rice | ancestry |
| `1006302712 80` | Basmati rice | the goods |

Suffix-80 alone does **not** mean declarable — `Declarable codes.IS_LEAF` is the only authority.

## Verified column positions

Positions are 0-indexed and authoritative. **`Measure exclusions` header labels are swapped
relative to their contents** — position 7 holds the country *name* ("India") while position 10
holds the ISO *code* ("IN"), despite the headers reading `Excluded country code` and
`Excluded country`. Keying on header text there silently yields names and never matches `IN`.

| File | Positions used |
| --- | --- |
| `Nomenclature EN.xlsx` | 0 `Goods code` (`"1006302712 80"`), 1 start, 2 end, 4 `Hier. Pos.`, 5 `Indent`, 6 description, 7 descr. start |
| `Declarable codes.xlsx` | 0 goods code+suffix, 1 start, 3 `IS_LEAF` (`"0"`/`"1"`), 4 end |
| `Duties Import 01-99.xlsx` | 0 goods code (10-digit, **no suffix**), 1 add code, 2 order no., 3 start, 4 end, 5 red. ind., 6 origin desc, 7 measure type desc, 8 legal base, 9 **raw duty**, 10 **origin code**, 11 **measure type code** |
| `Geographical areas composition.xlsx` | 0 group, 5 member country code, 8 mbship start, 9 mbship end, 10 group end |
| `Measure exclusions.xlsx` | 0 goods, 2 order no., 3 start, 4 end, 8 origin code, 9 type code, **10 excluded ISO code** |
| `Measure conditions.xlsx` | 0 goods, 2 order no., 3 start, 4 end, 5 origin code, 6 type code, 7 cond type, 8 sequence, 9 certificate, 14 action |
| `Measure footnotes.xlsx` | 0 goods, 2 order no., 3 origin code, 4 start, 5 end, 6 type code, 9 footnote code |
| `Legal basis.xlsx` | 0 legal base, 1 OJ, 2 page, 3 publication date |

## Measure types seen on rice

`103` third country duty · `142` tariff preference · `143` preferential tariff quota ·
`122` non-preferential tariff quota · `695` additional duties · `465` restriction on entry into
free circulation · `713`/`731`/`750`/`760`/`762` import controls · `106` customs union duty ·
`107` low-value consignment.

Only `142`/`143` are preferential. `122` is a **quota**, not a preference.

## Ground truth: HS6 100630 at reference 2026-09-01

- 187 nomenclature rows; **108 declarable** (`IS_LEAF=1`) — the same 108 the UK publishes, as
  expected since the UK inherited this nomenclature.
- India is an effective member of 19 country groups.
- 67 live measures reach Basmati `1006302712` via the cascade; **12** are India-applicable.
- The India picture, which is exactly what the product must not simplify:
  - **Third country duty (103, ERGA OMNES): `175.000 EUR TNE`** — specific, per tonne. It has no
    percentage and must never be rendered as one.
  - **Non-preferential tariff quota (122, origin `IN`, order `094117`): `0.000 %`** — conditional
    on certificates `L001`/`Y100`. A 0% *quota* is not a 0% tariff.
  - **No type-142 tariff preference exists for India on rice.** India preference is therefore not
    "confirmed applicable"; the quota is a volume entitlement requiring origin proof.
  - Import control (731, origin `IN`) with certificate conditions; additional duties (695) that
    are themselves conditional; a restriction on entry into free circulation (465).
  - India is **excluded** from quota `094119` on group `1008`.

## What TARIC does not prove

TARIC carries tariff and the customs-facing prohibitions/restrictions attached to measures. It is
not a complete product-regulatory corpus for any member state. Absence of a restriction here means
*not found in TARIC*, never *no requirements exist*, so regulatory coverage stays PARTIAL.
