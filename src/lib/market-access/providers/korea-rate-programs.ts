/**
 * Korea Customs Service (관세청) rate-program registry — one entry per 관세율구분/용도세율구분
 * symbol observed in the 2026-02-11 품목번호별 관세율표 release (data.go.kr dataset 15051179).
 *
 * ## Source
 *
 * Every label below is copied VERBATIM from the `srchTrrtTpcdDtl` (세율상세구분) dropdown on Korea
 * Customs Service's own 관세법령정보포털 CLIP tariff-history search page —
 * `https://unipass.customs.go.kr/clip/hsinfosrch/openULS0401009Q.do` — a live, official KCS system,
 * fetched directly (not reverse-engineered: this is the public search form's own rendered HTML).
 * Retrieved 2026-09-03. This is the SAME symbol space the XLSX publishes under 관세율구분: every one
 * of the 224 distinct codes observed in the real 2026-02-11 release resolves against this
 * dictionary with zero misses (verified by direct set comparison).
 *
 * `program_class`, `agreement`, `partner`, `selection_number` and `recommendation` below are
 * DERIVED from the verbatim Korean label by `classifyKoreaRateProgram`, using deterministic
 * substring/pattern rules on the label text — never from the symbol string itself, which is
 * exactly the trap this whole exercise exists to avoid (e.g. `FCEPA1` looks like it could name a
 * "CEPA" partner, but its authoritative label is "한ㆍ중미 FTA협정세율_파나마(선택1)" — Korea-
 * Central America FTA, Panama's country-specific schedule (선택N = "selection N", the FTA's own
 * multiple tariff-elimination-schedule options for one line, not a country codeselector) — and
 * `FIN1` is "한ㆍ인도 FTA협정세율(선택1)" — Korea-India FTA/CEPA, genuinely India).
 *
 * A symbol observed in a future release that is NOT in this dictionary is not silently accepted —
 * see `resolveKoreaRateProgram`'s `resolved: false` case, consumed by korea-parser.ts to keep an
 * unknown code retained-but-unresolved rather than guessed.
 */

/** [symbol, verbatim Korean label from CLIP] */
const RAW_DICTIONARY: ReadonlyArray<readonly [string, string]> = [
  ['A1', '기본세율(선택1)'],
  ['C2A1', 'WTO협정세율(선택14)'],
  ['C2A2', 'WTO협정세율(선택15)'],
  ['C2A3', 'WTO협정세율(선택16)'],
  ['C2A4', 'WTO협정세율(선택17)'],
  ['C2A5', 'WTO협정세율(선택18)'],
  ['C2A6', 'WTO협정세율(선택19)'],
  ['C2A7', 'WTO협정세율(선택20)'],
  ['C2A8', 'WTO협정세율(선택21)'],
  ['C2A9', 'WTO협정세율(선택22)'],
  ['C5', 'WTO협정세율(선택12)'],
  ['C6', 'WTO협정세율(선택13)'],
  ['E1A10', '아시아ㆍ태평양 협정세율(선택10)'],
  ['E1A7', '아시아ㆍ태평양 협정세율(선택7)'],
  ['E1A8', '아시아ㆍ태평양 협정세율(선택8)'],
  ['E1A9', '아시아ㆍ태평양 협정세율(선택9)'],
  ['E1B1', '아시아ㆍ태평양 협정세율(선택1)'],
  ['E1B2', '아시아ㆍ태평양 협정세율(선택2)'],
  ['E1B3', '아시아ㆍ태평양 협정세율(선택3)'],
  ['E1B4', '아시아ㆍ태평양 협정세율(선택4)'],
  ['FAE1', '한ㆍUAE CEPA(선택1)'],
  ['FAE2', '한ㆍUAE CEPA(선택2)'],
  ['FAE3', '한ㆍUAE CEPA(선택3)'],
  ['FAE4', '한ㆍUAE CEPA(선택4)'],
  ['FASPH3', '한ㆍ아세안 FTA상호대응세율(필리핀3)'],
  ['FASTH', '한ㆍ아세안 FTA상호대응세율(태국)'],
  ['FCESV1', '한ㆍ중미 FTA협정세율_엘살바도르(선택1)'],
  ['FCESV2', '한ㆍ중미 FTA협정세율_엘살바도르(선택2)'],
  ['FCESV3', '한ㆍ중미 FTA협정세율_엘살바도르(선택3)'],
  ['FCESV4', '한ㆍ중미 FTA협정세율_엘살바도르(선택4)'],
  ['FCESV5', '한ㆍ중미 FTA협정세율_엘살바도르(선택5)'],
  ['FCESV6', '한ㆍ중미 FTA협정세율_엘살바도르(선택6)'],
  ['FCESV7', '한ㆍ중미 FTA협정세율_엘살바도르(추천)'],
  ['FEFCH1', '한ㆍEFTA FTA협정세율(선택8)'],
  ['FEFCH2', '한ㆍEFTA FTA협정세율(선택9)'],
  ['FEFIS1', '한ㆍEFTA FTA협정세율(선택12)'],
  ['FEFIS2', '한ㆍEFTA FTA협정세율(선택13)'],
  ['FEFNO1', '한ㆍEFTA FTA협정세율(선택10)'],
  ['FEFNO2', '한ㆍEFTA FTA협정세율(선택11)'],
  ['FID1', '한ㆍ인도네시아 CEPA(선택1)'],
  ['FID2', '한ㆍ인도네시아 CEPA(선택2)'],
  ['FID3', '한ㆍ인도네시아 CEPA(선택3)'],
  ['FID4', '한ㆍ인도네시아 CEPA(선택4)'],
  ['FID5', '한ㆍ인도네시아 CEPA(선택5)'],
  ['FID6', '한ㆍ인도네시아 CEPA(선택6)'],
  ['FID7', '한ㆍ인도네시아 CEPA(선택7)'],
  ['FID8', '한ㆍ인도네시아 CEPA(선택8)'],
  ['FID9', '한ㆍ인도네시아 CEPA(선택9)'],
  ['FIL1', '한ㆍ이스라엘 FTA(선택1)'],
  ['FIL2', '한ㆍ이스라엘 FTA(선택2)'],
  ['FIL3', '한ㆍ이스라엘 FTA(선택3)'],
  ['FIL4', '한ㆍ이스라엘 FTA(선택4)'],
  ['FIL5', '한ㆍ이스라엘 FTA(선택5)'],
  ['FIL6', '한ㆍ이스라엘 FTA(선택6)'],
  ['FIL7', '한ㆍ이스라엘 FTA(선택7)'],
  ['FIL8', '한ㆍ이스라엘 FTA(선택8)'],
  ['FIL9', '한ㆍ이스라엘 FTA(선택9)'],
  ['FKH1', '한ㆍ캄보디아 FTA(선택1)'],
  ['FKH2', '한ㆍ캄보디아 FTA(선택2)'],
  ['FKH3', '한ㆍ캄보디아 FTA(선택3)'],
  ['FKH4', '한ㆍ캄보디아 FTA(선택4)'],
  ['FKH5', '한ㆍ캄보디아 FTA(선택5)'],
  ['FKH6', '한ㆍ캄보디아 FTA(선택6)'],
  ['FKH7', '한ㆍ캄보디아 FTA(선택7)'],
  ['FKH8', '한ㆍ캄보디아 FTA(선택8)'],
  ['FKH9', '한ㆍ캄보디아 FTA(선택9)'],
  ['FPH1', '한ㆍ필리핀 FTA(선택1)'],
  ['FPH2', '한ㆍ필리핀 FTA(선택2)'],
  ['FPH3', '한ㆍ필리핀 FTA(선택3)'],
  ['FPH4', '한ㆍ필리핀 FTA(선택4)'],
  ['FPH5', '한ㆍ필리핀 FTA(선택5)'],
  ['FRCAS1', 'RCEP협정세율_아세안(선택1)'],
  ['FRCAS2', 'RCEP협정세율_아세안(선택2)'],
  ['FRCAS3', 'RCEP협정세율_아세안(선택3)'],
  ['FRCAS4', 'RCEP협정세율_아세안(선택4)'],
  ['FRCAS5', 'RCEP협정세율_아세안(선택5)'],
  ['FRCAS6', 'RCEP협정세율_아세안(선택6)'],
  ['FRCAS7', 'RCEP협정세율_아세안(선택7)'],
  ['FRCAS8', 'RCEP협정세율_아세안(선택8)'],
  ['FRCAS9', 'RCEP협정세율_아세안(선택9)'],
  ['FRCAU1', 'RCEP협정세율_호주(선택1)'],
  ['FRCAU2', 'RCEP협정세율_호주(선택2)'],
  ['FRCAU3', 'RCEP협정세율_호주(선택3)'],
  ['FRCAU4', 'RCEP협정세율_호주(선택4)'],
  ['FRCAU5', 'RCEP협정세율_호주(선택5)'],
  ['FRCAU6', 'RCEP협정세율_호주(선택6)'],
  ['FRCAU7', 'RCEP협정세율_호주(선택7)'],
  ['FRCAU8', 'RCEP협정세율_호주(선택8)'],
  ['FRCAU9', 'RCEP협정세율_호주(선택9)'],
  ['FRCCN1', 'RCEP협정세율_중국(선택1)'],
  ['FRCCN2', 'RCEP협정세율_중국(선택2)'],
  ['FRCCN3', 'RCEP협정세율_중국(선택3)'],
  ['FRCCN4', 'RCEP협정세율_중국(선택4)'],
  ['FRCCN5', 'RCEP협정세율_중국(선택5)'],
  ['FRCCN6', 'RCEP협정세율_중국(선택6)'],
  ['FRCCN7', 'RCEP협정세율_중국(선택7)'],
  ['FRCCN8', 'RCEP협정세율_중국(선택8)'],
  ['FRCCN9', 'RCEP협정세율_중국(선택9)'],
  ['FRCJP1', 'RCEP협정세율_일본(선택1)'],
  ['FRCJP2', 'RCEP협정세율_일본(선택2)'],
  ['FRCJP3', 'RCEP협정세율_일본(선택3)'],
  ['FRCJP4', 'RCEP협정세율_일본(선택4)'],
  ['FRCJP5', 'RCEP협정세율_일본(선택5)'],
  ['FRCJP6', 'RCEP협정세율_일본(선택6)'],
  ['FRCJP7', 'RCEP협정세율_일본(선택7)'],
  ['FRCJP8', 'RCEP협정세율_일본(선택8)'],
  ['FRCJP9', 'RCEP협정세율_일본(선택9)'],
  ['FRCNZ1', 'RCEP협정세율_뉴질랜드(선택1)'],
  ['FRCNZ2', 'RCEP협정세율_뉴질랜드(선택2)'],
  ['FRCNZ3', 'RCEP협정세율_뉴질랜드(선택3)'],
  ['FRCNZ4', 'RCEP협정세율_뉴질랜드(선택4)'],
  ['FRCNZ5', 'RCEP협정세율_뉴질랜드(선택5)'],
  ['FRCNZ6', 'RCEP협정세율_뉴질랜드(선택6)'],
  ['FRCNZ7', 'RCEP협정세율_뉴질랜드(선택7)'],
  ['FRCNZ8', 'RCEP협정세율_뉴질랜드(선택8)'],
  ['FRCNZ9', 'RCEP협정세율_뉴질랜드(선택9)'],
  ['P1', '할당관세(물량이내추천)(선택1)'],
  ['P2', '할당관세(물량이내추천)(선택2)'],
  ['P3', '할당관세(수입전량)'],
  ['P4', '할당관세(물량이내추천)(선택3)'],
  ['A', '기본세율'],
  ['B', '잠정세율'],
  ['C', 'WTO협정세율'],
  ['C1', 'WTO협정세율(선택1)'],
  ['C2', 'WTO협정세율(선택2)'],
  ['C3', 'WTO협정세율(선택10)'],
  ['C4', 'WTO협정세율(선택11)'],
  ['CIT', 'WTO협정세율(선택3)'],
  ['CIT1', 'WTO협정세율(선택4)'],
  ['CIT2', 'WTO협정세율(선택5)'],
  ['CIT3', 'WTO협정세율(선택6)'],
  ['CIT4', 'WTO협정세율(선택7)'],
  ['CIT5', 'WTO협정세율(선택8)'],
  ['CIT6', 'WTO협정세율(선택9)'],
  ['D', 'WTO개도국협정세율'],
  ['E1', '아시아ㆍ태평양 협정세율(일반)'],
  ['E1A1', '아시아ㆍ태평양 협정세율(선택1)'],
  ['E1A2', '아시아ㆍ태평양 협정세율(선택2)'],
  ['E1A3', '아시아ㆍ태평양 협정세율(선택3)'],
  ['E1A4', '아시아ㆍ태평양 협정세율(선택4)'],
  ['E1A5', '아시아ㆍ태평양 협정세율(선택5)'],
  ['E1A6', '아시아ㆍ태평양 협정세율(선택6)'],
  ['E1L1', '아시아ㆍ태평양 협정세율(선택1)'],
  ['E1L2', '아시아ㆍ태평양 협정세율(선택2)'],
  ['E1L3', '아시아ㆍ태평양 협정세율(선택3)'],
  ['E1L4', '아시아ㆍ태평양 협정세율(선택4)'],
  ['E1L5', '아시아ㆍ태평양 협정세율(선택5)'],
  ['E1L6', '아시아ㆍ태평양 협정세율(선택6)'],
  ['E1L7', '아시아ㆍ태평양 협정세율(선택7)'],
  ['E2', '아시아ㆍ태평양 협정세율(방글라데시)'],
  ['E2A1', '아시아ㆍ태평양 협정세율(방글라데시)(선택1)'],
  ['E2A2', '아시아ㆍ태평양 협정세율(방글라데시)(선택2)'],
  ['E2A3', '아시아ㆍ태평양 협정세율(방글라데시)(선택3)'],
  ['E3', '아시아ㆍ태평양 협정세율(라오스)'],
  ['E3A1', '아시아ㆍ태평양 협정세율(라오스)(선택1)'],
  ['E3A2', '아시아ㆍ태평양 협정세율(라오스)(선택2)'],
  ['E3A3', '아시아ㆍ태평양 협정세율(라오스)(선택3)'],
  ['F', '국제협력관세'],
  ['F1', '국제협력관세(선택1)'],
  ['FAS1', '한ㆍ아세안 FTA협정세율(선택1)'],
  ['FAS2', '한ㆍ아세안 FTA협정세율(선택2)'],
  ['FAS3', '한ㆍ아세안 FTA협정세율(선택3)'],
  ['FAS4', '한ㆍ아세안 FTA협정세율(선택4)'],
  ['FASID', '한ㆍ아세안 FTA상호대응세율(인도네시아)'],
  ['FASMM', '한ㆍ아세안 FTA상호대응세율(미얀마)'],
  ['FASMY', '한ㆍ아세안 FTA상호대응세율(말레이시아)'],
  ['FASPH1', '한ㆍ아세안 FTA상호대응세율(필리핀1)'],
  ['FASPH2', '한ㆍ아세안 FTA상호대응세율(필리핀2)'],
  ['FASVN1', '한ㆍ아세안 FTA상호대응세율(베트남1)'],
  ['FASVN2', '한ㆍ아세안 FTA상호대응세율(베트남2)'],
  ['FAU1', '한ㆍ호주 FTA협정세율(선택1)'],
  ['FAU10', '한ㆍ호주 FTA협정세율(선택10)'],
  ['FAU11', '한ㆍ호주 FTA협정세율(선택11)'],
  ['FAU2', '한ㆍ호주 FTA협정세율(선택2)'],
  ['FAU3', '한ㆍ호주 FTA협정세율(선택3)'],
  ['FAU4', '한ㆍ호주 FTA협정세율(선택4)'],
  ['FAU5', '한ㆍ호주 FTA협정세율(선택5)'],
  ['FAU6', '한ㆍ호주 FTA협정세율(선택6)'],
  ['FAU7', '한ㆍ호주 FTA협정세율(선택7)'],
  ['FAU8', '한ㆍ호주 FTA협정세율(선택8)'],
  ['FAU9', '한ㆍ호주 FTA협정세율(선택9)'],
  ['FCA1', '한ㆍ캐나다 FTA협정세율(선택1)'],
  ['FCA10', '한ㆍ캐나다 FTA협정세율(선택10)'],
  ['FCA11', '한ㆍ캐나다 FTA협정세율(선택11)'],
  ['FCA12', '한ㆍ캐나다 FTA협정세율(선택12)'],
  ['FCA2', '한ㆍ캐나다 FTA협정세율(선택2)'],
  ['FCA3', '한ㆍ캐나다 FTA협정세율(선택3)'],
  ['FCA4', '한ㆍ캐나다 FTA협정세율(선택4)'],
  ['FCA5', '한ㆍ캐나다 FTA협정세율(선택5)'],
  ['FCA6', '한ㆍ캐나다 FTA협정세율(선택6)'],
  ['FCA7', '한ㆍ캐나다 FTA협정세율(선택7)'],
  ['FCA8', '한ㆍ캐나다 FTA협정세율(선택8)'],
  ['FCA9', '한ㆍ캐나다 FTA협정세율(선택9)'],
  ['FCECR1', '한ㆍ중미 FTA협정세율_코스타리카(선택1)'],
  ['FCECR2', '한ㆍ중미 FTA협정세율_코스타리카(선택2)'],
  ['FCECR3', '한ㆍ중미 FTA협정세율_코스타리카(선택3)'],
  ['FCECR4', '한ㆍ중미 FTA협정세율_코스타리카(선택4)'],
  ['FCECR5', '한ㆍ중미 FTA협정세율_코스타리카(선택5)'],
  ['FCECR6', '한ㆍ중미 FTA협정세율_코스타리카(선택6)'],
  ['FCEHN1', '한ㆍ중미 FTA협정세율_온두라스(선택1)'],
  ['FCEHN2', '한ㆍ중미 FTA협정세율_온두라스(선택2)'],
  ['FCEHN3', '한ㆍ중미 FTA협정세율_온두라스(선택3)'],
  ['FCEHN4', '한ㆍ중미 FTA협정세율_온두라스(선택4)'],
  ['FCEHN5', '한ㆍ중미 FTA협정세율_온두라스(선택5)'],
  ['FCEHN6', '한ㆍ중미 FTA협정세율_온두라스(선택6)'],
  ['FCEHN7', '한ㆍ중미 FTA협정세율_온두라스(추천)'],
  ['FCENI1', '한ㆍ중미 FTA협정세율_니카라과(선택1)'],
  ['FCENI2', '한ㆍ중미 FTA협정세율_니카라과(선택2)'],
  ['FCENI3', '한ㆍ중미 FTA협정세율_니카라과(선택3)'],
  ['FCENI4', '한ㆍ중미 FTA협정세율_니카라과(선택4)'],
  ['FCENI5', '한ㆍ중미 FTA협정세율_니카라과(선택5)'],
  ['FCENI6', '한ㆍ중미 FTA협정세율_니카라과(선택6)'],
  ['FCENI7', '한ㆍ중미 FTA협정세율_니카라과(추천)'],
  ['FCEPA1', '한ㆍ중미 FTA협정세율_파나마(선택1)'],
  ['FCEPA2', '한ㆍ중미 FTA협정세율_파나마(선택2)'],
  ['FCEPA3', '한ㆍ중미 FTA협정세율_파나마(선택3)'],
  ['FCEPA4', '한ㆍ중미 FTA협정세율_파나마(선택4)'],
  ['FCEPA5', '한ㆍ중미 FTA협정세율_파나마(선택5)'],
  ['FCEPA6', '한ㆍ중미 FTA협정세율_파나마(선택6)'],
  ['FCEPA7', '한ㆍ중미 FTA협정세율_파나마(추천)'],
  ['FCEPA8', '한ㆍ중미 FTA협정세율_파나마(선택8)'],
  ['FCL1', '한ㆍ칠레FTA협정세율(선택1)'],
  ['FCL2', '한ㆍ칠레FTA협정세율(선택2)'],
  ['FCL5', '한ㆍ칠레FTA협정세율(추천)'],
  ['FCL6', '한ㆍ칠레FTA협정세율(미추천)'],
  ['FCN1', '한ㆍ중국 FTA협정세율(선택1)'],
  ['FCN10', '한ㆍ중국 FTA협정세율(선택10)'],
  ['FCN11', '한ㆍ중국 FTA협정세율(선택11)'],
  ['FCN2', '한ㆍ중국 FTA협정세율(선택2)'],
  ['FCN3', '한ㆍ중국 FTA협정세율(선택3)'],
  ['FCN4', '한ㆍ중국 FTA협정세율(선택4)'],
  ['FCN5', '한ㆍ중국 FTA협정세율(선택5)'],
  ['FCN6', '한ㆍ중국 FTA협정세율(선택6)'],
  ['FCN7', '한ㆍ중국 FTA협정세율(선택7)'],
  ['FCN8', '한ㆍ중국 FTA협정세율(선택8)'],
  ['FCN9', '한ㆍ중국 FTA협정세율(선택9)'],
  ['FCO1', '한ㆍ콜롬비아FTA협정세율(선택1)'],
  ['FCO2', '한ㆍ콜롬비아FTA협정세율(선택2)'],
  ['FCO3', '한ㆍ콜롬비아FTA협정세율(선택3)'],
  ['FCO4', '한ㆍ콜롬비아FTA협정세율(선택4)'],
  ['FCO5', '한ㆍ콜롬비아FTA협정세율(선택5)'],
  ['FCO6', '한ㆍ콜롬비아FTA협정세율(선택6)'],
  ['FCO7', '한ㆍ콜롬비아FTA협정세율(선택7)'],
  ['FCO8', '한ㆍ콜롬비아FTA협정세율(선택8)'],
  ['FCO9', '한ㆍ콜롬비아FTA협정세율(선택9)'],
  ['FEF1', '한ㆍEFTA FTA협정세율(선택1)'],
  ['FEF2', '한ㆍEFTA FTA협정세율(선택2)'],
  ['FEF3', '한ㆍEFTA FTA협정세율(선택3)'],
  ['FEF4', '한ㆍEFTA FTA협정세율(선택4)'],
  ['FEFCH', '한ㆍEFTA FTA협정세율(선택5)'],
  ['FEFIS', '한ㆍEFTA FTA협정세율(선택7)'],
  ['FEFNO', '한ㆍEFTA FTA협정세율(선택6)'],
  ['FEU1', '한ㆍEU FTA협정세율(선택1)'],
  ['FEU10', '한ㆍEU FTA협정세율(선택10)'],
  ['FEU11', '한ㆍEU FTA협정세율(선택11)'],
  ['FEU2', '한ㆍEU FTA협정세율(선택2)'],
  ['FEU3', '한ㆍEU FTA협정세율(선택3)'],
  ['FEU4', '한ㆍEU FTA협정세율(선택4)'],
  ['FEU5', '한ㆍEU FTA협정세율(선택5)'],
  ['FEU6', '한ㆍEU FTA협정세율(선택6)'],
  ['FEU7', '한ㆍEU FTA협정세율(선택7)'],
  ['FEU8', '한ㆍEU FTA협정세율(선택8)'],
  ['FEU9', '한ㆍEU FTA협정세율(선택9)'],
  ['FGB1', '한ㆍ영국 FTA협정세율(선택1)'],
  ['FGB2', '한ㆍ영국 FTA협정세율(선택2)'],
  ['FGB3', '한ㆍ영국 FTA협정세율(선택3)'],
  ['FGB4', '한ㆍ영국 FTA협정세율(선택4)'],
  ['FGB5', '한ㆍ영국 FTA협정세율(선택5)'],
  ['FGB6', '한ㆍ영국 FTA협정세율(선택6)'],
  ['FGB7', '한ㆍ영국 FTA협정세율(선택7)'],
  ['FGB8', '한ㆍ영국 FTA협정세율(선택8)'],
  ['FGB9', '한ㆍ영국 FTA협정세율(선택9)'],
  ['FIN1', '한ㆍ인도 FTA협정세율(선택1)'],
  ['FIN2', '한ㆍ인도 FTA협정세율(선택2)'],
  ['FIN3', '한ㆍ인도 FTA협정세율(선택3)'],
  ['FIN4', '한ㆍ인도 FTA협정세율(선택4)'],
  ['FNZ1', '한ㆍ뉴질랜드 FTA협정세율(선택1)'],
  ['FNZ10', '한ㆍ뉴질랜드 FTA협정세율(선택10)'],
  ['FNZ11', '한ㆍ뉴질랜드 FTA협정세율(선택11)'],
  ['FNZ12', '한ㆍ뉴질랜드 FTA협정세율(선택12)'],
  ['FNZ2', '한ㆍ뉴질랜드 FTA협정세율(선택2)'],
  ['FNZ3', '한ㆍ뉴질랜드 FTA협정세율(선택3)'],
  ['FNZ4', '한ㆍ뉴질랜드 FTA협정세율(선택4)'],
  ['FNZ5', '한ㆍ뉴질랜드 FTA협정세율(선택5)'],
  ['FNZ6', '한ㆍ뉴질랜드 FTA협정세율(선택6)'],
  ['FNZ7', '한ㆍ뉴질랜드 FTA협정세율(선택7)'],
  ['FNZ8', '한ㆍ뉴질랜드 FTA협정세율(선택8)'],
  ['FNZ9', '한ㆍ뉴질랜드 FTA협정세율(선택9)'],
  ['FPE1', '한ㆍ페루 FTA협정세율(선택1)'],
  ['FPE2', '한ㆍ페루 FTA협정세율(선택2)'],
  ['FPE3', '한ㆍ페루 FTA협정세율(선택3)'],
  ['FPE4', '한ㆍ페루 FTA협정세율(선택4)'],
  ['FPE5', '한ㆍ페루 FTA협정세율(선택5)'],
  ['FPE6', '한ㆍ페루 FTA협정세율(선택6)'],
  ['FSG1', '한ㆍ싱가포르FTA협정세율(선택1)'],
  ['FSG2', '한ㆍ싱가포르FTA협정세율(선택2)'],
  ['FSG3', '한ㆍ싱가포르FTA협정세율(선택3)'],
  ['FSG4', '한ㆍ싱가포르FTA협정세율(선택4)'],
  ['FSG5', '한ㆍ싱가포르FTA협정세율(선택5)'],
  ['FTA1', '한ㆍ아세안 FTA협정세율(선택1)'],
  ['FTA2', '한ㆍ아세안 FTA협정세율(선택2)'],
  ['FTA3', '한ㆍ아세안 FTA협정세율(선택3)'],
  ['FTA4', '한ㆍ아세안 FTA협정세율(선택4)'],
  ['FTE1', '한ㆍEFTA FTA협정세율(선택1)'],
  ['FTE2', '한ㆍEFTA FTA협정세율(선택2)'],
  ['FTE3', '한ㆍEFTA FTA협정세율(선택3)'],
  ['FTE4', '한ㆍEFTA FTA협정세율(선택4)'],
  ['FTE5', '한ㆍEFTA FTA협정세율(선택5)'],
  ['FTE6', '한ㆍEFTA FTA협정세율(선택6)'],
  ['FTE7', '한ㆍEFTA FTA협정세율(선택7)'],
  ['FTR1', '한ㆍ터키 FTA협정세율(선택1)'],
  ['FTR2', '한ㆍ터키 FTA협정세율(선택2)'],
  ['FTR3', '한ㆍ터키 FTA협정세율(선택3)'],
  ['FTR4', '한ㆍ터키 FTA협정세율(선택4)'],
  ['FTR5', '한ㆍ터키 FTA협정세율(선택5)'],
  ['FTR6', '한ㆍ터키 FTA협정세율(선택6)'],
  ['FTR7', '한ㆍ터키 FTA협정세율(선택7)'],
  ['FTR8', '한ㆍ터키 FTA협정세율(선택8)'],
  ['FTR9', '한ㆍ터키 FTA협정세율(선택9)'],
  ['FUS1', '한ㆍ미 FTA 협정세율(선택1)'],
  ['FUS10', '한ㆍ미 FTA 협정세율(선택10)'],
  ['FUS11', '한ㆍ미 FTA 협정세율(선택11)'],
  ['FUS12', '한ㆍ미 FTA 협정세율(선택12)'],
  ['FUS2', '한ㆍ미 FTA 협정세율(선택2)'],
  ['FUS3', '한ㆍ미 FTA 협정세율(선택3)'],
  ['FUS4', '한ㆍ미 FTA 협정세율(선택4)'],
  ['FUS5', '한ㆍ미 FTA 협정세율(선택5)'],
  ['FUS6', '한ㆍ미 FTA 협정세율(선택6)'],
  ['FUS7', '한ㆍ미 FTA 협정세율(선택7)'],
  ['FUS8', '한ㆍ미 FTA 협정세율(선택8)'],
  ['FUS9', '한ㆍ미 FTA 협정세율(선택9)'],
  ['FVN1', '한ㆍ베트남 FTA협정세율(선택1)'],
  ['FVN10', '한ㆍ베트남 FTA협정세율(선택10)'],
  ['FVN2', '한ㆍ베트남 FTA협정세율(선택2)'],
  ['FVN3', '한ㆍ베트남 FTA협정세율(선택3)'],
  ['FVN4', '한ㆍ베트남 FTA협정세율(선택4)'],
  ['FVN5', '한ㆍ베트남 FTA협정세율(선택5)'],
  ['FVN6', '한ㆍ베트남 FTA협정세율(선택6)'],
  ['FVN7', '한ㆍ베트남 FTA협정세율(선택7)'],
  ['FVN8', '한ㆍ베트남 FTA협정세율(선택8)'],
  ['FVN9', '한ㆍ베트남 FTA협정세율(선택9)'],
  ['G1', 'UN개도국협정세율'],
  ['G2', 'UN개도국협정세율(최빈국)'],
  ['H', '한중마늘 합의세율'],
  ['I', '덤핑방지관세'],
  ['J', '보복관세'],
  ['K', '긴급관세'],
  ['L', '조정관세'],
  ['M', '상계관세'],
  ['N', '편익관세'],
  ['O', '물가평형관세'],
  ['Q', '환특세율'],
  ['R', '최빈국특혜관세'],
  ['S', '쌍무협정세율'],
  ['T1', '특별긴급관세(물량기준)'],
  ['T2', '특별긴급관세(가격기준)'],
  ['U', '북한산'],
  ['W1', '농림축산물양허관세(추천)'],
  ['W2', '농림축산물양허관세(미추천)'],
  ['W3', '농림축산물양허관세(증량분)'],
  ['X', '간이세율'],
  ['Y1', '한ㆍ칠레FTA협정세율(선택1)'],
  ['Y2', '한ㆍ칠레FTA협정세율(선택2)'],
  ['Y5', '한ㆍ칠레FTA협정세율(추천)'],
  ['Y6', '한ㆍ칠레FTA협정세율(미추천)'],
  ['Z', '한,싱가폴FTA'],
  ['Z1', '한ㆍ싱가포르FTA협정세율(선택1)'],
  ['Z2', '한ㆍ싱가포르FTA협정세율(선택2)'],
  ['Z3', '한ㆍ싱가포르FTA협정세율(선택3)'],
  ['Z4', '한ㆍ싱가포르FTA협정세율(선택4)'],
  ['Z5', '한ㆍ싱가포르FTA협정세율(선택5)'],
];

export const KOREA_RATE_PROGRAM_SOURCE_AUTHORITY = 'Korea Customs Service — 관세법령정보포털 CLIP (unipass.customs.go.kr/clip)' as const;
export const KOREA_RATE_PROGRAM_SOURCE_REFERENCE = 'https://unipass.customs.go.kr/clip/hsinfosrch/openULS0401009Q.do (세율상세구분 dropdown)' as const;
export const KOREA_RATE_PROGRAM_VERIFIED_AT = '2026-09-03' as const;

export type KoreaRateProgramClass =
  | 'basic'
  | 'wto'
  | 'wto_developing'
  | 'apta'
  | 'fta_bilateral'
  | 'fta_regional'
  | 'quota'
  | 'special_safeguard'
  | 'agricultural_concession'
  | 'origin_special'
  | 'trade_remedy'
  | 'preferential_other'
  | 'other';

export interface KoreaRateProgram {
  symbol: string;
  /** Verbatim as published by CLIP. Never translated in place — translation is a derived field. */
  kcs_label_ko: string;
  program_class: KoreaRateProgramClass;
  /** Normalised English name of the agreement/scheme, when the label names one. */
  agreement: string | null;
  /** The specific partner/sub-schedule the label names, when distinct from the agreement itself
   *  (e.g. RCEP's per-partner schedules, or Central America's per-country schedules). */
  partner: string | null;
  /** Parsed from "(선택N)" — an alternative tariff-treatment option within the same agreement/line,
   *  not a different partner or agreement. Null when the label carries no selection number. */
  selection_number: number | null;
  /** True when the label itself states a recommendation condition ("추천"/"미추천"). */
  is_recommendation_conditional: boolean;
  /** True only when the label explicitly says NO recommendation is required ("미추천" or "수입전량" —
   *  full quantity, no recommendation gate). Null when recommendation conditionality does not apply
   *  to this program at all. */
  recommendation_required: boolean | null;
  is_preferential: boolean;
  is_quota: boolean;
  source_authority: typeof KOREA_RATE_PROGRAM_SOURCE_AUTHORITY;
  source_reference: typeof KOREA_RATE_PROGRAM_SOURCE_REFERENCE;
  verified_at: typeof KOREA_RATE_PROGRAM_VERIFIED_AT;
}

const AGREEMENT_PATTERNS: ReadonlyArray<{ test: RegExp; agreement: string; regional: boolean }> = [
  { test: /^RCEP협정세율/, agreement: 'RCEP', regional: true },
  { test: /^한ㆍ중미 FTA협정세율/, agreement: 'Korea-Central America FTA', regional: true },
  { test: /^한ㆍ아세안 FTA협정세율/, agreement: 'Korea-ASEAN FTA', regional: true },
  { test: /^한ㆍ아세안 FTA상호대응세율/, agreement: 'Korea-ASEAN FTA (reciprocal/matching rate)', regional: true },
  { test: /^한ㆍEFTA FTA협정세율/, agreement: 'Korea-EFTA FTA', regional: true },
  { test: /^한ㆍEU FTA협정세율/, agreement: 'Korea-EU FTA', regional: false },
  { test: /^한ㆍUAE CEPA/, agreement: 'Korea-UAE CEPA', regional: false },
  { test: /^한ㆍ인도네시아 CEPA/, agreement: 'Korea-Indonesia CEPA', regional: false },
  { test: /^한ㆍ인도 FTA협정세율/, agreement: 'Korea-India FTA/CEPA', regional: false },
  { test: /^한ㆍ이스라엘 FTA/, agreement: 'Korea-Israel FTA', regional: false },
  { test: /^한ㆍ캄보디아 FTA/, agreement: 'Korea-Cambodia FTA', regional: false },
  { test: /^한ㆍ필리핀 FTA/, agreement: 'Korea-Philippines FTA', regional: false },
  { test: /^한ㆍ호주 FTA협정세율/, agreement: 'Korea-Australia FTA', regional: false },
  { test: /^한ㆍ캐나다 FTA협정세율/, agreement: 'Korea-Canada FTA', regional: false },
  { test: /^한ㆍ칠레\s*FTA협정세율/, agreement: 'Korea-Chile FTA', regional: false },
  { test: /^한ㆍ중국 FTA협정세율/, agreement: 'Korea-China FTA', regional: false },
  { test: /^한ㆍ콜롬비아\s*FTA협정세율/, agreement: 'Korea-Colombia FTA', regional: false },
  { test: /^한ㆍ영국 FTA협정세율/, agreement: 'Korea-UK FTA', regional: false },
  { test: /^한ㆍ뉴질랜드 FTA협정세율/, agreement: 'Korea-New Zealand FTA', regional: false },
  { test: /^한ㆍ페루 FTA협정세율/, agreement: 'Korea-Peru FTA', regional: false },
  { test: /^한ㆍ싱가포르\s*FTA협정세율/, agreement: 'Korea-Singapore FTA', regional: false },
  { test: /^한,싱가폴FTA/, agreement: 'Korea-Singapore FTA', regional: false },
  { test: /^한ㆍ터키 FTA협정세율/, agreement: 'Korea-Turkey FTA', regional: false },
  { test: /^한ㆍ미 FTA\s*협정세율/, agreement: 'Korea-US FTA', regional: false },
  { test: /^한ㆍ베트남 FTA협정세율/, agreement: 'Korea-Vietnam FTA', regional: false },
];

const REGIONAL_PARTNER_NAMES: Record<string, string> = {
  아세안: 'ASEAN', 호주: 'Australia', 중국: 'China', 일본: 'Japan', 뉴질랜드: 'New Zealand',
  파나마: 'Panama', 코스타리카: 'Costa Rica', 온두라스: 'Honduras', 니카라과: 'Nicaragua', 엘살바도르: 'El Salvador',
  인도네시아: 'Indonesia', 미얀마: 'Myanmar', 말레이시아: 'Malaysia', 필리핀: 'Philippines', 태국: 'Thailand', 베트남: 'Vietnam',
  방글라데시: 'Bangladesh', 라오스: 'Laos',
};

function parseSelectionNumber(label: string): number | null {
  const m = /\(선택(\d+)\)/.exec(label);
  return m ? Number(m[1]) : null;
}

function parseRecommendation(label: string): { conditional: boolean; required: boolean | null } {
  if (label.includes('(미추천)')) return { conditional: true, required: false };
  if (label.includes('(추천)') || label.includes('물량이내추천')) return { conditional: true, required: true };
  if (label.includes('수입전량')) return { conditional: true, required: false };
  return { conditional: false, required: null };
}

function parseRegionalPartner(label: string): string | null {
  const underscoreMatch = /_([^(]+)\(/.exec(label);
  if (underscoreMatch) {
    const raw = underscoreMatch[1]!.trim();
    return REGIONAL_PARTNER_NAMES[raw] ?? raw;
  }
  // "...상호대응세율(필리핀1)" style: partner named inside the parens, digit/추천 suffix stripped.
  const parenMatch = /\(([^)0-9]+)\d*\)$/.exec(label);
  if (parenMatch) {
    const raw = parenMatch[1]!.trim();
    if (raw !== '선택' && raw !== '추천' && raw !== '미추천' && raw) return REGIONAL_PARTNER_NAMES[raw] ?? raw;
  }
  return null;
}

/** Deterministic classification of ONE verbatim CLIP label. Pure function; no IO. */
export function classifyKoreaRateProgram(symbol: string, label: string): Omit<KoreaRateProgram, 'symbol' | 'kcs_label_ko' | 'source_authority' | 'source_reference' | 'verified_at'> {
  const selection = parseSelectionNumber(label);
  const rec = parseRecommendation(label);

  if (label === '기본세율' || /^기본세율/.test(label)) {
    return { program_class: 'basic', agreement: null, partner: null, selection_number: selection, is_recommendation_conditional: rec.conditional, recommendation_required: rec.required, is_preferential: false, is_quota: false };
  }
  if (/^WTO개도국협정세율/.test(label)) {
    return { program_class: 'wto_developing', agreement: 'WTO developing-country agreement rate', partner: null, selection_number: selection, is_recommendation_conditional: rec.conditional, recommendation_required: rec.required, is_preferential: true, is_quota: false };
  }
  if (/^WTO협정세율/.test(label)) {
    return { program_class: 'wto', agreement: 'WTO bound/concession rate', partner: null, selection_number: selection, is_recommendation_conditional: rec.conditional, recommendation_required: rec.required, is_preferential: false, is_quota: false };
  }
  if (/^아시아ㆍ태평양 협정세율/.test(label)) {
    const partner = parseRegionalPartner(label);
    return { program_class: 'apta', agreement: 'Asia-Pacific Trade Agreement (APTA)', partner, selection_number: selection, is_recommendation_conditional: rec.conditional, recommendation_required: rec.required, is_preferential: true, is_quota: false };
  }
  if (/^할당관세/.test(label)) {
    return { program_class: 'quota', agreement: null, partner: null, selection_number: selection, is_recommendation_conditional: rec.conditional, recommendation_required: rec.required, is_preferential: false, is_quota: true };
  }
  if (/^특별긴급관세/.test(label)) {
    const basis = label.includes('물량기준') ? 'volume-based' : label.includes('가격기준') ? 'price-based' : null;
    return { program_class: 'special_safeguard', agreement: basis, partner: null, selection_number: selection, is_recommendation_conditional: rec.conditional, recommendation_required: rec.required, is_preferential: false, is_quota: false };
  }
  if (/^농림축산물양허관세/.test(label)) {
    return { program_class: 'agricultural_concession', agreement: null, partner: null, selection_number: selection, is_recommendation_conditional: rec.conditional, recommendation_required: rec.required, is_preferential: false, is_quota: true };
  }
  if (label === '북한산') {
    return { program_class: 'origin_special', agreement: 'North Korean origin', partner: 'KP', selection_number: null, is_recommendation_conditional: false, recommendation_required: null, is_preferential: true, is_quota: false };
  }
  if (['덤핑방지관세', '보복관세', '긴급관세', '상계관세'].includes(label)) {
    const map: Record<string, string> = { 덤핑방지관세: 'anti-dumping duty', 보복관세: 'retaliatory duty', 긴급관세: 'emergency safeguard duty', 상계관세: 'countervailing duty' };
    return { program_class: 'trade_remedy', agreement: map[label] ?? null, partner: null, selection_number: null, is_recommendation_conditional: false, recommendation_required: null, is_preferential: false, is_quota: false };
  }
  if (label === '최빈국특혜관세') {
    return { program_class: 'preferential_other', agreement: 'least-developed-country preference', partner: null, selection_number: null, is_recommendation_conditional: false, recommendation_required: null, is_preferential: true, is_quota: false };
  }
  if (/^UN개도국협정세율/.test(label)) {
    return { program_class: 'preferential_other', agreement: 'UN developing-country agreement rate', partner: label.includes('최빈국') ? 'least-developed subset' : null, selection_number: null, is_recommendation_conditional: false, recommendation_required: null, is_preferential: true, is_quota: false };
  }
  for (const { test, agreement, regional } of AGREEMENT_PATTERNS) {
    if (test.test(label)) {
      const partner = regional ? parseRegionalPartner(label) : null;
      return { program_class: regional ? 'fta_regional' : 'fta_bilateral', agreement, partner, selection_number: selection, is_recommendation_conditional: rec.conditional, recommendation_required: rec.required, is_preferential: true, is_quota: false };
    }
  }
  // 잠정세율(provisional), 편익관세(benefit tariff), 물가평형관세(price-stabilisation), 환특세율
  // (bonded-area-related), 쌍무협정세율(bilateral treaty rate), 간이세율(simplified rate),
  // 한중마늘 합의세율(Korea-China garlic agreed rate) — real, named Korean customs mechanisms, none
  // observed in the 2026-02-11 XLSX release, retained here only because CLIP publishes them.
  return { program_class: 'other', agreement: null, partner: null, selection_number: selection, is_recommendation_conditional: rec.conditional, recommendation_required: rec.required, is_preferential: false, is_quota: false };
}

const REGISTRY: ReadonlyMap<string, KoreaRateProgram> = new Map(
  RAW_DICTIONARY.map(([symbol, label]) => [symbol, {
    symbol, kcs_label_ko: label,
    ...classifyKoreaRateProgram(symbol, label),
    source_authority: KOREA_RATE_PROGRAM_SOURCE_AUTHORITY,
    source_reference: KOREA_RATE_PROGRAM_SOURCE_REFERENCE,
    verified_at: KOREA_RATE_PROGRAM_VERIFIED_AT,
  }]),
);

export type KoreaRateProgramResolution =
  | { resolved: true; program: KoreaRateProgram }
  | { resolved: false; symbol: string };

/** The full registry, for audits/reporting. */
export function allKoreaRatePrograms(): readonly KoreaRateProgram[] {
  return [...REGISTRY.values()];
}

/** Look up one rate-type/purpose-code symbol. Never throws — an unresolved symbol is a real,
 *  reportable outcome, not an error, since KCS may add symbols this registry has not yet seen. */
export function resolveKoreaRateProgram(symbol: string): KoreaRateProgramResolution {
  const program = REGISTRY.get(symbol);
  return program ? { resolved: true, program } : { resolved: false, symbol };
}

/** Every symbol CLIP itself labels as the Korea-India FTA/CEPA rate — derived from the registry,
 *  never hand-maintained as a separate guess list. In the 2026-02-11 XLSX only FIN1 and FIN2 carry
 *  any rows; FIN3/FIN4 exist in CLIP's vocabulary but are unused in that release. */
export const INDIA_FTA_RATE_CODES: readonly string[] = allKoreaRatePrograms()
  .filter((p) => p.agreement === 'Korea-India FTA/CEPA')
  .map((p) => p.symbol)
  .sort();

/** Every symbol CLIP labels as a quota-tariff (할당관세) rate. */
export const QUOTA_RATE_CODES: readonly string[] = allKoreaRatePrograms()
  .filter((p) => p.program_class === 'quota')
  .map((p) => p.symbol)
  .sort();

/** Price-based and volume-based agricultural special-safeguard (특별긴급관세) rate codes. */
export const SPECIAL_SAFEGUARD_RATE_CODES: readonly string[] = allKoreaRatePrograms()
  .filter((p) => p.program_class === 'special_safeguard')
  .map((p) => p.symbol)
  .sort();

/** The confirmed general/basic rate code — 기본세율, used as the erga-omnes duty. */
export const GENERAL_RATE_CODE = 'A' as const;
/** The confirmed WTO-bound/concession rate code — kept distinct from the general rate. */
export const WTO_BOUND_RATE_CODE = 'C' as const;
