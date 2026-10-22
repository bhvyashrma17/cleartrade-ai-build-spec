/** One row of HMRC's importer details in the published layout (D-033, docs/38 §2): period, line number, name, five address lines, postcode, 50 code slots. */
export function hmrcLine(period: string, lineNo: number, name: string, address: string[], postcode: string, codes: string[]) {
  const addr = [...address, '', '', '', '', ''].slice(0, 5);
  return [period, String(lineNo), name, ...addr, postcode, ...[...codes, ...Array(50).fill('')].slice(0, 50)].join('\t');
}
