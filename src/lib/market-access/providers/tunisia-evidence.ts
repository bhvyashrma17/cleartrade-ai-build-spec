/**
 * Reviewed identities for the Tunisia acquisition. The WTO notifications, the Trade Policy Review, the Finance
 * Law 2026 bulletin and the copyright law are pinned by exact byte length and SHA-256; Tarifweb line pages are
 * hashed per page in the manifest but not pinned, because they are the live tariff. The 2026 Bulletin officiel
 * des douanes set is the reviewed enumeration against which a new bulletin fails closed.
 */
export interface TunisiaPin { bytes: number; sha256: string }
export const TUNISIA_PINS: Readonly<Record<'tpr_2025' | 'safeguard_notification' | 'trq_administration' | 'trq_fill_2024' | 'ssg_2024' | 'finance_law_2026' | 'finance_law_2026_application' | 'law_94_36', TunisiaPin>> = Object.freeze({
  tpr_2025: { bytes: 5_964_848, sha256: '5511cd0de62212e5a0170960331d6e94a5d2218e336d74ada713d4ab41d97cf7' },
  safeguard_notification: { bytes: 103_379, sha256: '432fa608711e113a41fedb9fecb953b437ea74230426ab5de670634a00dd22aa' },
  trq_administration: { bytes: 23_513, sha256: '38c654a26637fd9ff6dc6c44a2933826e9fc1eecdf7912b41d636531353ad028' },
  trq_fill_2024: { bytes: 61_609, sha256: 'bb9bc1f13f9d0fb51e8ae7d50a6c801786361043fcc701c0ef27af6dd47698d2' },
  ssg_2024: { bytes: 285_657, sha256: '86ab054a69c30bf16d643d5523f007a666ee1bf973971564b2c9644934a104b9' },
  finance_law_2026: { bytes: 664_447, sha256: '3fbfae0d14795fdd4375b40bb3cedf860b37c0b4e8891f5c6fb5efeb0e6f8654' },
  finance_law_2026_application: { bytes: 812_439, sha256: '3d62d7583ff8aba6e44d356814a9c55cc0943d12e982bdbe9c7d6d37d809078d' },
  law_94_36: { bytes: 122_358, sha256: '109531b81dca397c90370c239023c08392ea60a9ffac5577cbb54c552948bd86' },
});
/**
 * The Bulletin officiel des douanes index labels each row with its number ("019_2026"); some bulletins are
 * served from a separate large-file folder, so the enumeration is by label, not by URL. Every 2026 bulletin
 * (001–034) was reviewed in full (Arabic OCR): customs-broker administration (011, 012, 028, 030, 031),
 * valuation notes (019), procedures, origin and AfCFTA notices — none changes a customs-duty rate. The last
 * 2025 bulletins were reviewed too: 036 (origin-proof validity), 037 (express parcels), 038 (the Finance Law
 * 2026 itself) and 039 (Customs' application note for the Finance Law 2026, pinned). Any further bulletin
 * fails acquisition closed until it is reviewed.
 */
export const TUNISIA_REVIEWED_2026_BULLETINS = 34;
export const TUNISIA_LAST_REVIEWED_2025_BULLETIN = 39;
