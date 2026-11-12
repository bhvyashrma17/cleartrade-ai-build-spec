/**
 * The Natural Earth files the geography snapshot is built from, pinned by release, commit and
 * sha256 (D-048, docs/38 §3). Natural Earth is in the public domain: nothing to credit, nothing to
 * buy. The GeoJSON edition is the one Natural Earth publishes in its own repository; the four files
 * below are byte-identical at the v5.1.2 release and at the repository's head on 12 Nov 2026.
 */

export const NATURAL_EARTH_RELEASE = 'v5.1.2';
export const NATURAL_EARTH_COMMIT = 'f1890d9f152c896d250a77557a5751a93d494776';

export type NaturalEarthLayer = 'populated_places_simple' | 'admin_1_states_provinces' | 'ports' | 'airports';

export interface NaturalEarthFile {
  layer: NaturalEarthLayer;
  file: string;
  url: string;
  sha256: string;
  bytes: number;
}

const file = (layer: NaturalEarthLayer, sha256: string, bytes: number): NaturalEarthFile => ({
  layer,
  file: `ne_10m_${layer}.geojson`,
  url: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH_COMMIT}/geojson/ne_10m_${layer}.geojson`,
  sha256,
  bytes,
});

/** Read on 12 Nov 2026. A different file is refused by the build, never used. */
export const NATURAL_EARTH_FILES: readonly NaturalEarthFile[] = [
  file('populated_places_simple', 'fd3fa867a320cbd5c5b6bb5bc550afeec2939fb2cef688e508007282a55ac42f', 4_932_147),
  file('admin_1_states_provinces', '22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5', 40_726_851),
  file('ports', 'c5a5028f5187a5e1b9fe7f0fab99804a8be7482099a2365d404fb7e9dd6b5457', 279_075),
  file('airports', '28892a892f670f1cf654c62253c6169fdc2504b92c956addb4ac8224f50cebe0', 1_217_477),
];
