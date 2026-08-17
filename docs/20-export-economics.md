# Export Economics evidence contract

`export-economics-v1` is the existing 15% Demand Discovery component. It asks whether the
exporter's own offer is commercially plausible in a destination; it is not another demand
measure. Its configured subweights are 45% comparison with India-origin import unit values,
35% comparison with destination total import unit values, and 20% verified tariff burden.

The component is available only when all of the following are present:

- a positive exporter target price with currency, per-quantity unit, and Incoterm;
- USD currency (until a timestamped authoritative FX source is connected);
- CIF Incoterm (until explicit freight/insurance evidence permits basis normalization);
- positive latest-year Comtrade quantities and unit values for both destination-total and
  India-origin observations, in the same recognized quantity unit as the exporter price;
- a current COMPLETE Market Access snapshot with a verified tariff applicable to Indian origin.

UNSD's official IMTS 2010 methodology recommends CIF-type statistical valuation for imports
and FOB-type valuation for exports. The scorer therefore treats the import observations used
here as CIF-type, records that basis in provenance, and never compares them with EXW, FOB,
DDP, or other exporter bases. See the [UN IMTS 2010 methodology](https://unstats.un.org/unsd/trade/eg-imts/imts2010-final-22march2011.pdf).

Quantity aliases are canonicalized only where they express the same unit (for example `KGM`
and `kg`). No dimensional conversion is performed. Mass, count, volume, and area remain
incompatible, and manifest/package units (`PKG`, `CTN`, boxes, cases, packages) are rejected.

The stored component provenance contains formula version, component confidence, source
evidence IDs and observations, currencies, FX requirement/source/time, quantity basis,
Incoterm basis, and unavailable reasons. Missing evidence returns unavailable and causes the
eight-component model to redistribute the 15% weight while lowering overall confidence.

