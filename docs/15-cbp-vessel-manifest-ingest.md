# US CBP inward vessel manifest ingest

## Verified access mechanism (14 Aug 2026)

The current public-data mechanism in 19 CFR §103.31 is **not an API**. CBP distributes
specified inward-vessel-manifest fields as daily CD-ROM deliveries purchased by written
request/subscription. ACE Portal and EDI access are authenticated trade-filing mechanisms,
not a public buyer-discovery feed. A 2026 proposed rule would replace CD-ROM delivery with
SFTP, but a proposal is not the current access contract.

The source is vessel-only. It excludes air, courier and truck movements. Consignee and
shipper identities can be removed when confidentiality has been granted, so absence never
means that a buyer or shipment does not exist. Product copy and derived APIs must describe
results as observed public vessel-manifest records, never a complete list of US buyers.

The public element list includes manifest quantity and its package unit, but does not
guarantee customs value, HS code, or a reliable origin-country field. Those values stay
nullable. Foreign loading port must not be relabelled as origin country.

## Input boundary

The ingest accepts newline-delimited normalized JSON from an acquired CBP delivery. This is
intentional: no raw CD-ROM layout/sample was available to validate, so the repository does
not pretend to contain a verified raw-media parser. Every row requires `source_record_id`
and `shipment_date`; optional source fields remain null rather than inferred.

A strict sidecar JSON file is mandatory and must contain every key below:

```json
{
  "source_provider": "US Customs and Border Protection",
  "license_type": "19 CFR 103.31 public vessel manifest",
  "allowed_to_display": false,
  "allowed_to_export": false,
  "allowed_to_cache": true,
  "retention_limit": null,
  "personal_data_flag": true,
  "retrieved_at": "2026-08-14T00:00:00.000Z",
  "scope": "us_inward_vessel_manifest"
}
```

Ingest is rejected when caching is not permitted or retention has expired. Future display,
export, and aggregation paths must use `assertImportRecordUse` or `importRecordUseWhere`.
There is deliberately no API route exposing `ImportRecord`, raw or projected.
