/**
 * The product code finder (E-043; the owner's choice of option B: no AI, works without any outside
 * service). Pure: the HS 2022 code list in, suggestions out.
 *
 * 1. Search: each word of the exporter's description scores the codes whose official description
 *    holds it, rarer words counting more; a one-letter slip still matches; an everyday name
 *    ("jeera", "pooja thali") lifts the codes it is known to fall under.
 * 2. Ask: when the closest codes differ on a detail the exporter did not give (material, fresh or
 *    frozen, whole or ground, knitted, printed, who it is for, pack size, kind of rice), the finder
 *    asks about that detail, with the answers the descriptions themselves offer, plus "Other / not
 *    sure". Each answer narrows the codes, until none of these details separates them.
 * 3. Show: at most three codes with their official descriptions. The exporter picks one and an
 *    agent confirms it; the finder never decides a code.
 */
import type { HsCodeRow } from '@/lib/reference-datasets/baci-products';
import { EVERYDAY_NAMES, type EverydayName } from './everyday-names';

export interface HsFinderInput {
  description: string;
  /** Answers already given, by dimension key: `{ material: 'copper' }`. */
  answers?: Readonly<Record<string, string>>;
}
export interface HsCandidate { hs6: string; description: string; matched: string[] }
export interface HsQuestion { dimension: string; text: string; options: { value: string; label: string }[] }
export interface HsFinderResult {
  candidates: HsCandidate[];
  /** The next detail to ask about; null when no detail separates the codes left. */
  question: HsQuestion | null;
  /** Further codes that also match, beyond the three shown. */
  more: number;
  /** Details read from the exporter's own words ("brass" as copper or brass), so they are not asked. */
  understood: { dimension: string; value: string; label: string }[];
  note: string | null;
}

interface Dimension {
  key: string;
  text: string;
  /** Match after removing "other than …", "not …" phrases, so a code's exclusions do not count as its own. */
  strip_negations: boolean;
  /** `pattern` reads official descriptions; `hint`, when given, reads the exporter's own words instead. */
  values: { key: string; label: string; pattern: RegExp; hint?: RegExp }[];
  /** A more specific value hides a general one it implies. */
  hides?: Record<string, string[]>;
}

export const DIMENSIONS: readonly Dimension[] = [
  {
    key: 'material', text: 'What is it mainly made of?', strip_negations: true,
    values: [
      { key: 'cotton', label: 'Cotton', pattern: /\bcotton\b/, hint: /\bcotton\b|\bkhadi\b/ },
      { key: 'wool', label: 'Wool or fine animal hair', pattern: /\bwool\b|fine animal hair/, hint: /\bwool(len)?\b|pashmina|cashmere/ },
      { key: 'silk', label: 'Silk', pattern: /\bsilk\b/ },
      { key: 'synthetic', label: 'Synthetic or artificial fibres', pattern: /synthetic|artificial|man-made/, hint: /polyester|nylon|synthetic|viscose|rayon/ },
      { key: 'jute', label: 'Jute', pattern: /\bjute\b/ },
      { key: 'leather', label: 'Leather', pattern: /\bleather\b/ },
      { key: 'rubber', label: 'Rubber', pattern: /\brubber\b/ },
      { key: 'plastics', label: 'Plastic', pattern: /\bplastics?\b/, hint: /\bplastics?\b|\bpvc\b|polypropylene/ },
      { key: 'wood', label: 'Wood', pattern: /\bwood(en)?\b/, hint: /\bwood(en)?\b|sheesham|teak/ },
      { key: 'paper', label: 'Paper or paperboard', pattern: /\bpaper(board)?\b/ },
      { key: 'glass', label: 'Glass', pattern: /\bglass\b/ },
      { key: 'porcelain', label: 'Porcelain or china', pattern: /porcelain|\bchina\b/, hint: /porcelain|bone china/ },
      { key: 'ceramic', label: 'Other ceramic (earthenware, stoneware)', pattern: /ceramic/, hint: /ceramic|terracotta|\bclay\b|pottery|earthenware|stoneware/ },
      { key: 'stone', label: 'Stone, marble or granite', pattern: /\bstone\b|\bmarble\b|\bgranite\b|travertine|alabaster/, hint: /\bstone\b|marble|granite|sandstone|soapstone/ },
      { key: 'stainless', label: 'Stainless steel', pattern: /stainless steel/, hint: /stainless|\bsteel\b/ },
      { key: 'iron_steel', label: 'Iron or other steel', pattern: /\biron\b|\bsteel\b/, hint: /\biron\b/ },
      { key: 'copper', label: 'Copper or brass', pattern: /\bcopper\b|\bbrass\b/, hint: /\bcopper\b|\bbrass\b|\bpital\b|\btamba\b/ },
      { key: 'aluminium', label: 'Aluminium', pattern: /aluminium/, hint: /alumin(i)?um/ },
      { key: 'precious', label: 'Gold, silver or other precious metal', pattern: /precious metal|\bgold\b|\bsilver\b|platinum/ },
      { key: 'base_metal', label: 'Other base metal', pattern: /base metal/, hint: /base metal|\bzinc\b|\btin\b|white metal/ },
    ],
    hides: { porcelain: ['ceramic'], stainless: ['iron_steel'], copper: ['base_metal'], aluminium: ['base_metal'], iron_steel: ['base_metal'] },
  },
  {
    key: 'state', text: 'Is it fresh, frozen or dried?', strip_negations: false,
    values: [
      { key: 'fresh', label: 'Fresh or chilled', pattern: /\bfresh\b|\bchilled\b|\blive\b/, hint: /\bfresh\b|\bchilled\b/ },
      { key: 'frozen', label: 'Frozen', pattern: /\bfrozen\b/ },
      { key: 'dried', label: 'Dried', pattern: /\bdried\b/, hint: /\bdried\b|\bdry\b/ },
    ],
  },
  {
    key: 'grinding', text: 'Is it whole, or crushed or ground?', strip_negations: false,
    values: [
      { key: 'whole', label: 'Whole (neither crushed nor ground)', pattern: /neither crushed nor ground/, hint: /\bwhole\b|\bsabut\b/ },
      { key: 'ground', label: 'Crushed or ground', pattern: /(?<!neither )crushed or ground/, hint: /powder|\bground\b|crushed|\bpisa\b/ },
    ],
  },
  {
    key: 'roasting', text: 'Is it roasted?', strip_negations: false,
    values: [
      { key: 'not_roasted', label: 'Not roasted', pattern: /not roasted/, hint: /not roasted|unroasted|\braw\b/ },
      { key: 'roasted', label: 'Roasted', pattern: /(?<!not )roasted/ },
    ],
  },
  {
    key: 'shell', text: 'Is it in its shell, or shelled?', strip_negations: false,
    values: [
      { key: 'in_shell', label: 'In shell', pattern: /in shell/, hint: /in shell|unshelled/ },
      { key: 'shelled', label: 'Shelled', pattern: /\bshelled\b/, hint: /\bshelled\b|kernels?/ },
    ],
  },
  {
    key: 'rice', text: 'Which kind of rice?', strip_negations: false,
    values: [
      { key: 'milled', label: 'Milled (white), whether or not polished', pattern: /semi-milled or wholly milled/, hint: /white rice|\bpolished\b|\bmilled\b/ },
      { key: 'husked', label: 'Husked (brown)', pattern: /\bhusked\b|\bbrown\b/, hint: /brown rice|\bhusked\b/ },
      { key: 'broken', label: 'Broken', pattern: /\bbroken\b/ },
      { key: 'paddy', label: 'In the husk (paddy)', pattern: /in the husk|\bpaddy\b/ },
    ],
  },
  {
    key: 'knitting', text: 'Is it knitted or crocheted?', strip_negations: false,
    values: [
      { key: 'knitted', label: 'Knitted or crocheted', pattern: /(?<!not )knitted or crocheted/, hint: /(?<!not )knit(ted)?|crochet|hosiery/ },
      { key: 'not_knitted', label: 'Not knitted (woven or other)', pattern: /not knitted or crocheted|\(not knitted/, hint: /\bwoven\b|handloom|not knitted/ },
    ],
  },
  {
    key: 'printing', text: 'Is it printed?', strip_negations: false,
    values: [
      { key: 'printed', label: 'Printed', pattern: /(?<!not )\bprinted\b/ },
      { key: 'not_printed', label: 'Not printed', pattern: /not printed/ },
    ],
  },
  {
    key: 'user', text: 'Who is it for?', strip_negations: true,
    values: [
      { key: 'men', label: 'Men or boys', pattern: /\bmen'?s\b|\bmen\b|\bboys'?\b/, hint: /\bmen'?s?\b|\bgents\b|\bboys'?\b/ },
      { key: 'women', label: 'Women or girls', pattern: /\bwomen'?s\b|\bwomen\b|\bgirls'?\b/, hint: /\bwomen'?s?\b|\bladies\b|\bgirls'?\b/ },
      { key: 'babies', label: 'Babies', pattern: /\bbabies'?\b/, hint: /\bbab(y|ies)\b|\binfants?\b/ },
    ],
  },
  {
    key: 'packing', text: 'How is it packed?', strip_negations: false,
    values: [
      { key: 'small', label: 'In packs of up to 3 kg', pattern: /not exceeding 3 ?kg/, hint: /retail pack|small pack|\bpackets?\b|sachet/ },
      { key: 'bulk', label: 'In bulk (packs over 3 kg)', pattern: /(?<!not )exceeding 3 ?kg/, hint: /\bbulk\b|\bloose\b/ },
    ],
  },
];

export const OTHER = 'other';
const OTHER_LABEL = 'Other / not sure';
const SHOWN = 3;
const KEPT = 12;
const NAME_WEIGHT = 12;

const STOPWORDS = new Set(['a', 'an', 'and', 'or', 'of', 'the', 'for', 'in', 'on', 'with', 'without', 'to', 'by', 'its', 'their', 'whether', 'not', 'nor', 'neither', 'other', 'than', 'thereof', 'parts', 'similar', 'like', 'articles', 'article', 'products', 'product', 'made', 'used', 'kind', 'type', 'nes', 'etc', 'we', 'our', 'my', 'i', 'export', 'exports', 'item', 'items']);
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stem = (word: string) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);
export const tokenize = (text: string) => normalize(text).split(' ').filter((word) => word.length > 1 && !STOPWORDS.has(word)).map(stem);
const stripNegations = (text: string) => text.replace(/\b(other than|not|excluding|except)\b[^;,]*/g, ' ');
/** "(not printed, knitted or crocheted)" negates each item: read as "(not printed, not knitted or crocheted)". */
const distributeNegations = (text: string) => text.replace(/\(not ([^)]*)\)/g, (_match, list: string) => `(${list.split(', ').map((item) => (item.startsWith('not ') ? item : `not ${item}`)).join(', ')})`);

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else { i += 1; j += 1; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

interface IndexedCode { hs6: string; description: string; values: Map<string, Set<string>> }
export interface HsIndex {
  codes: Map<string, IndexedCode>;
  postings: Map<string, string[]>;
  names: { phrase: string; hs6: string[] }[];
}

function valuesOf(description: string): Map<string, Set<string>> {
  const lower = distributeNegations(description.toLowerCase());
  const stripped = stripNegations(lower);
  const result = new Map<string, Set<string>>();
  for (const dimension of DIMENSIONS) {
    const text = dimension.strip_negations ? stripped : lower;
    const found = new Set(dimension.values.filter((value) => value.pattern.test(text)).map((value) => value.key));
    for (const [specific, general] of Object.entries(dimension.hides ?? {})) if (found.has(specific)) for (const key of general) found.delete(key);
    result.set(dimension.key, found);
  }
  return result;
}

export function buildHsIndex(rows: readonly HsCodeRow[], names: readonly EverydayName[] = EVERYDAY_NAMES): HsIndex {
  const codes = new Map<string, IndexedCode>();
  const postings = new Map<string, string[]>();
  for (const row of rows) {
    codes.set(row.hs6, { hs6: row.hs6, description: row.description, values: valuesOf(row.description) });
    for (const token of new Set(tokenize(row.description))) {
      const list = postings.get(token);
      if (list) list.push(row.hs6);
      else postings.set(token, [row.hs6]);
    }
  }
  const phrases = names.flatMap((entry) => entry.names.map((name) => ({ phrase: normalize(name), hs6: entry.hs6.filter((code) => codes.has(code)) }))).filter((entry) => entry.phrase && entry.hs6.length);
  return { codes, postings, names: phrases };
}

function search(index: HsIndex, description: string): { hs6: string; score: number; matched: Set<string> }[] {
  const scores = new Map<string, { score: number; matched: Set<string> }>();
  const add = (hs6: string, points: number, why: string) => {
    const entry = scores.get(hs6) ?? { score: 0, matched: new Set<string>() };
    entry.score += points;
    entry.matched.add(why);
    scores.set(hs6, entry);
  };
  const query = ` ${normalize(description)} `;
  for (const name of index.names) if (query.includes(` ${name.phrase} `)) for (const hs6 of name.hs6) add(hs6, NAME_WEIGHT, name.phrase);
  const total = index.codes.size;
  for (const token of new Set(tokenize(description))) {
    let codes = index.postings.get(token);
    let word = token;
    if (!codes && token.length >= 5) {
      // A one-letter slip ("tumeric") matches the closest word the list uses.
      const near = [...index.postings.keys()].find((candidate) => candidate[0] === token[0] && withinOneEdit(candidate, token));
      if (near) { codes = index.postings.get(near); word = near; }
    }
    if (!codes) continue;
    const rarity = Math.log(1 + total / codes.length);
    for (const hs6 of codes) add(hs6, rarity, word);
  }
  return [...scores.entries()].map(([hs6, entry]) => ({ hs6, ...entry })).sort((a, b) => b.score - a.score || a.hs6.localeCompare(b.hs6));
}

/** Codes keeping an answer: those with that value; for "other", those with none of the dimension's values. */
function keeps(code: IndexedCode, dimension: string, answer: string): boolean {
  const values = code.values.get(dimension) ?? new Set<string>();
  return answer === OTHER ? values.size === 0 : values.has(answer);
}

function nextQuestion(codes: IndexedCode[], answered: ReadonlySet<string>): HsQuestion | null {
  let best: { question: HsQuestion; groups: number; largest: number } | null = null;
  for (const dimension of DIMENSIONS) {
    if (answered.has(dimension.key)) continue;
    const groups = new Map<string, number>();
    for (const code of codes) {
      const values = code.values.get(dimension.key) ?? new Set<string>();
      for (const value of values.size ? values : [OTHER]) groups.set(value, (groups.get(value) ?? 0) + 1);
    }
    const named = dimension.values.filter((value) => groups.has(value.key));
    if (!named.length || groups.size < 2) continue;
    const largest = Math.max(...groups.values());
    if (largest === codes.length && !groups.has(OTHER)) continue;
    const question: HsQuestion = { dimension: dimension.key, text: dimension.text, options: [...named.map((value) => ({ value: value.key, label: value.label })), { value: OTHER, label: OTHER_LABEL }] };
    if (!best || groups.size > best.groups || (groups.size === best.groups && largest < best.largest)) best = { question, groups: groups.size, largest };
  }
  return best?.question ?? null;
}

export function findHsCodes(index: HsIndex, input: HsFinderInput): HsFinderResult {
  const ranked = search(index, input.description);
  if (!ranked.length) {
    return { candidates: [], question: null, more: 0, understood: [], note: 'No product code matches these words. Try other words, such as what it is made of or what it is used for, or ask an agent.' };
  }
  const top = ranked[0]!.score;
  let kept = ranked.filter((entry) => entry.score >= top * 0.35).slice(0, KEPT);
  let note: string | null = null;
  const answered = new Set<string>();
  for (const [dimension, answer] of Object.entries(input.answers ?? {})) {
    if (!DIMENSIONS.some((item) => item.key === dimension)) continue;
    answered.add(dimension);
    const narrowed = kept.filter((entry) => keeps(index.codes.get(entry.hs6)!, dimension, answer));
    if (narrowed.length) kept = narrowed;
    else note = 'None of the closest codes matches one of your answers. Pick the nearest below, or ask an agent.';
  }
  // The exporter's own words answer a detail when exactly one of its answers appears in them, and only
  // where that answer leaves codes standing: "brass pooja thali" is not asked what it is made of.
  const words = ` ${input.description.toLowerCase()} `;
  const understood: HsFinderResult['understood'] = [];
  for (const dimension of DIMENSIONS) {
    if (answered.has(dimension.key) || kept.length < 2) continue;
    const said = dimension.values.filter((value) => (value.hint ?? value.pattern).test(words));
    if (said.length !== 1) continue;
    const narrowed = kept.filter((entry) => keeps(index.codes.get(entry.hs6)!, dimension.key, said[0]!.key));
    if (!narrowed.length || narrowed.length === kept.length) continue;
    kept = narrowed;
    answered.add(dimension.key);
    understood.push({ dimension: dimension.key, value: said[0]!.key, label: said[0]!.label });
  }
  const question = kept.length > 1 ? nextQuestion(kept.map((entry) => index.codes.get(entry.hs6)!), answered) : null;
  return {
    candidates: kept.slice(0, SHOWN).map((entry) => ({ hs6: entry.hs6, description: index.codes.get(entry.hs6)!.description, matched: [...entry.matched] })),
    question,
    more: Math.max(0, kept.length - SHOWN),
    understood,
    note,
  };
}
