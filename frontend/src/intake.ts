// Чистые функции для формы приёмки: маска телефона, раскладка, марки, модели,
// подбор неисправностей и срок по умолчанию. Без импортов и побочных эффектов.

// ---------------------------------------------------------------------------
// Телефон
// ---------------------------------------------------------------------------

/** Оставляет только цифры. */
export function phoneDigits(v: string): string {
  return v.replace(/\D+/g, '')
}

/** Ровно 11 цифр — номер набран полностью. */
export function isPhoneComplete(v: string): boolean {
  return phoneDigits(v).length === 11
}

/**
 * Маска телефона «8 (999) 123-45-67».
 * next — новое значение поля, prev — предыдущее (чтобы понять, что стёрли разделитель).
 */
export function formatPhoneInput(next: string, prev: string): string {
  const dNext = phoneDigits(next)
  const dPrev = phoneDigits(prev)

  let d = dNext
  // Стёрли скобку/пробел/дефис, а цифр столько же — значит хотели стереть цифру
  if (next.length < prev.length && dNext.length === dPrev.length && d.length > 0) {
    d = d.slice(0, -1)
  }
  if (d.length === 0) return ''

  const first = d[0]
  if (first === '7') d = '8' + d.slice(1)
  else if (first !== '8') d = '8' + d // «9…» и всё остальное — без восьмёрки
  d = d.slice(0, 11)

  if (d.length === 1) return '8 ('
  let out = '8 (' + d.slice(1, 4)
  if (d.length >= 5) out += ') ' + d.slice(4, 7)
  if (d.length >= 8) out += '-' + d.slice(7, 9)
  if (d.length >= 10) out += '-' + d.slice(9, 11)
  return out
}

// ---------------------------------------------------------------------------
// Раскладка
// ---------------------------------------------------------------------------

const RU_TO_EN: Record<string, string> = {
  й: 'q', ц: 'w', у: 'e', к: 'r', е: 't', н: 'y', г: 'u', ш: 'i', щ: 'o',
  з: 'p', х: '[', ъ: ']', ф: 'a', ы: 's', в: 'd', а: 'f', п: 'g', р: 'h',
  о: 'j', л: 'k', д: 'l', ж: ';', э: "'", я: 'z', ч: 'x', с: 'c', м: 'v',
  и: 'b', т: 'n', ь: 'm', б: ',', ю: '.', ё: '`',
}

/** Текст, набранный в русской раскладке вместо английской: «фззду» → «apple». */
export function fixLayout(text: string): string {
  let out = ''
  for (const ch of text) {
    const lower = ch.toLocaleLowerCase('ru-RU')
    const mapped = RU_TO_EN[lower]
    if (mapped === undefined) out += ch
    else out += ch !== lower ? mapped.toUpperCase() : mapped
  }
  return out
}

// ---------------------------------------------------------------------------
// Марки
// ---------------------------------------------------------------------------

export const BRAND_ALIASES: Record<string, string[]> = {
  Apple: ['эпл', 'эппл', 'апл', 'аппл', 'епл', 'эпол', 'айфон', 'iphone', 'яблоко', 'ipad', 'айпад'],
  Samsung: ['самсунг', 'самсунк', 'самсун', 'галакси', 'galaxy'],
  Xiaomi: ['сяоми', 'сиаоми', 'ксиаоми', 'ксяоми', 'шаоми', 'ксиоми', 'ксаоми', 'ми'],
  Redmi: ['редми'],
  POCO: ['поко'],
  Huawei: ['хуавей', 'хуавэй', 'хуавеи', 'хувей'],
  Honor: ['хонор', 'онор'],
  Realme: ['реалми', 'рилми'],
  OnePlus: ['ванплюс', 'уанплюс', 'ван плюс'],
  Google: ['гугл', 'пиксель', 'pixel'],
  Nokia: ['нокиа', 'нокия'],
  Sony: ['сони'],
  Oppo: ['оппо'],
  Vivo: ['виво'],
  Tecno: ['текно', 'техно'],
  Infinix: ['инфиникс'],
  Motorola: ['моторола', 'моторолла'],
  Asus: ['асус'],
  Lenovo: ['леново'],
  Meizu: ['мейзу'],
  ZTE: ['зте'],
  LG: ['лж', 'элджи'],
  Nothing: ['нотинг', 'насинг'],
  Acer: ['асер', 'ацер'],
  HP: ['хп'],
  Dell: ['делл'],
  MSI: ['мси'],
  Microsoft: ['майкрософт'],
  Nintendo: ['нинтендо'],
  JBL: ['жбл'],
  Dyson: ['дайсон'],
}

/** trim, нижний регистр, ё→е, одиночные пробелы. */
function normStr(s: string): string {
  return s.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ')
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  let cur = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]
}

/** Сколько опечаток прощаем: короткие слова — ни одной, 4–6 букв — одну, длиннее — две. */
function levThreshold(len: number): number {
  if (len >= 7) return 2
  if (len >= 4) return 1
  return 0
}

/** Каноничное написание марки («эпл» → «Apple», «фззду» → «Apple») или null. */
export function normalizeBrand(input: string, known: string[] = []): string | null {
  const norm = normStr(input)
  if (norm === '') return null
  const canonicals = Object.keys(BRAND_ALIASES)

  const exact = (term: string): string | null => {
    for (const c of canonicals) if (normStr(c) === term) return c
    for (const k of known) if (normStr(k) === term) return k
    for (const c of canonicals) if (BRAND_ALIASES[c].some((a) => normStr(a) === term)) return c
    return null
  }
  const direct = exact(norm)
  if (direct) return direct
  const fixed = normStr(fixLayout(input))
  if (fixed !== norm) {
    const viaLayout = exact(fixed)
    if (viaLayout) return viaLayout
  }

  const threshold = levThreshold(norm.length)
  if (threshold === 0) return null
  let best: string | null = null
  let bestDist = threshold + 1
  const consider = (candidate: string, canonical: string) => {
    const dist = levenshtein(norm, candidate)
    if (dist <= threshold && dist < bestDist) {
      bestDist = dist
      best = canonical
    }
  }
  for (const c of canonicals) consider(normStr(c), c)
  for (const k of known) consider(normStr(k), k)
  for (const c of canonicals) for (const a of BRAND_ALIASES[c]) consider(normStr(a), c)
  return best
}

/** Подсказки марок по мере ввода. */
export function suggestBrands(input: string, known: string[] = [], limit = 6): string[] {
  const norm = normStr(input)
  if (norm === '') return []
  const fixed = normStr(fixLayout(input))
  const canonicals = Object.keys(BRAND_ALIASES)
  const result: string[] = []
  const seen = new Set<string>()
  const push = (v: string) => {
    const key = normStr(v)
    if (seen.has(key)) return
    seen.add(key)
    result.push(v)
  }

  const recognized = normalizeBrand(input, known)
  if (recognized) push(recognized)
  const starts = (v: string) => {
    const n = normStr(v)
    return n.startsWith(norm) || (fixed !== norm && n.startsWith(fixed))
  }
  for (const k of known) if (starts(k)) push(k)
  for (const c of canonicals) if (starts(c)) push(c)
  for (const c of canonicals) if (BRAND_ALIASES[c].some((a) => normStr(a).startsWith(norm))) push(c)
  return result.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Модели
// ---------------------------------------------------------------------------

const NUM_WORDS: Record<string, number> = {
  ноль: 0, один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5,
  шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11,
  двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15,
  шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
  двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60,
  семьдесят: 70, восемьдесят: 80, девяносто: 90, сто: 100,
}
const TENS = new Set(['двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'])

const MODEL_WORDS: Record<string, string> = {
  айфон: 'iPhone', iphone: 'iPhone',
  айпад: 'iPad', ipad: 'iPad',
  макбук: 'MacBook', macbook: 'MacBook',
  эйрподс: 'AirPods', аирподс: 'AirPods', airpods: 'AirPods',
  вотч: 'Watch', watch: 'Watch',
  про: 'Pro', pro: 'Pro',
  макс: 'Max', max: 'Max',
  плюс: 'Plus', plus: 'Plus', '+': 'Plus',
  мини: 'mini', mini: 'mini',
  ультра: 'Ultra', ultra: 'Ultra',
  лайт: 'Lite', lite: 'Lite',
  ноут: 'Note', нот: 'Note', note: 'Note',
  галакси: 'Galaxy', galaxy: 'Galaxy',
  эйр: 'Air', аир: 'Air', air: 'Air',
  се: 'SE', se: 'SE',
  икс: 'X', x: 'X',
  xr: 'XR', xs: 'XS',
  фе: 'FE', fe: 'FE',
  редми: 'Redmi', redmi: 'Redmi',
  поко: 'POCO', poco: 'POCO',
  фолд: 'Fold', fold: 'Fold',
  флип: 'Flip', flip: 'Flip',
  пиксель: 'Pixel', pixel: 'Pixel',
  эс: 'S',
  а: 'A',
}

/** Слово из букв — с заглавной; цифры с буквами — буквы заглавные (7a → 7A). */
function normalizeToken(tok: string): string {
  if (/^\d+$/.test(tok)) return tok
  if (/^[a-zа-я]+$/i.test(tok)) return tok.charAt(0).toLocaleUpperCase('ru-RU') + tok.slice(1)
  if (/^[0-9a-zа-я]+$/i.test(tok)) return tok.toLocaleUpperCase('ru-RU')
  return tok
}

/** «айфон семь плюс» → «iPhone 7 Plus»; при марке Apple «7» → «iPhone 7». */
export function normalizeModel(input: string, brand = ''): string {
  const norm = normStr(input)
  if (norm === '') return ''
  const raw = norm.split(' ')

  // Числа словами → цифры, «двадцать три» → 23
  const nums: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const val = NUM_WORDS[raw[i]]
    if (val === undefined) {
      nums.push(raw[i])
      continue
    }
    const nextVal = NUM_WORDS[raw[i + 1] ?? '']
    if (TENS.has(raw[i]) && nextVal !== undefined && nextVal >= 1 && nextVal <= 9) {
      nums.push(String(val + nextVal))
      i++
    } else nums.push(String(val))
  }

  // «икс эр» → XR, «икс эс» → XS
  const pairs: string[] = []
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] === 'икс' && (nums[i + 1] === 'эр' || nums[i + 1] === 'эс')) {
      pairs.push(nums[i + 1] === 'эр' ? 'XR' : 'XS')
      i++
    } else pairs.push(nums[i])
  }

  const mapped = pairs.map((tok) => MODEL_WORDS[tok] ?? normalizeToken(tok))

  // Серия + номер слитно: «A 50» → «A50» (у Apple так не пишут)
  const brandNorm = normStr(brand)
  const isApple = brandNorm === 'apple'
  const glued: string[] = []
  for (let i = 0; i < mapped.length; i++) {
    if (!isApple && /^[ASMJZG]$/.test(mapped[i]) && /^\d+$/.test(mapped[i + 1] ?? '')) {
      glued.push(mapped[i] + mapped[i + 1])
      i++
    } else glued.push(mapped[i])
  }

  // Марку в модели не дублируем
  if (brandNorm !== '' && glued.length > 0 && normStr(glued[0]) === brandNorm) glued.shift()
  if (glued.length === 0) return ''

  const first = glued[0]
  if (isApple && (/^\d/.test(first) || ['SE', 'X', 'XR', 'XS'].includes(first))) glued.unshift('iPhone')
  return glued.join(' ')
}

// ---------------------------------------------------------------------------
// Неисправности и прочие справочники
// ---------------------------------------------------------------------------

/** Группы корней-синонимов: набрал «утоп» — найдётся «Залитие». */
export const PROBLEM_SYNONYMS: string[][] = [
  ['залит', 'утоп', 'вода', 'воды', 'жидк', 'влаг', 'мокр'],
  ['разби', 'треснул', 'трещин', 'стекл'],
  ['не заряж', 'заряд', 'разъем', 'гнезд'],
  ['не включ', 'не вкл', 'мертв'],
  ['аккум', 'батаре', 'акб', 'сад', 'разряж'],
  ['экран', 'дисплей', 'тачскрин', 'сенсор', 'тач'],
  ['динамик', 'не слышно', 'звук'],
  ['микрофон', 'не слышат'],
  ['камер'],
  ['face id', 'фейс', 'faceid'],
  ['wi-fi', 'вай фай', 'вайфай', 'wifi'],
  ['не ловит', 'сеть', 'симк', 'sim'],
  ['кнопк'],
  ['перезагруж', 'ребут', 'циклич'],
  ['пароль', 'забыл', 'блокир', 'icloud', 'айклауд', 'аккаунт'],
  ['вибр'],
  ['плат', 'пайк'],
]

/** Подбор вариантов справочника по вводу: начало, вхождение, раскладка, синонимы, корень. */
export function matchChoices(draft: string, choices: string[], limit = 8): string[] {
  const norm = normStr(draft)
  if (norm === '') return []
  const result: string[] = []
  const seen = new Set<string>()
  const push = (v: string) => {
    const key = normStr(v)
    if (seen.has(key)) return
    seen.add(key)
    result.push(v)
  }
  const normalized = choices.map((c) => [c, normStr(c)] as const)

  for (const [c, n] of normalized) if (n.startsWith(norm)) push(c)
  for (const [c, n] of normalized) if (n.includes(norm)) push(c)
  const fixed = normStr(fixLayout(draft))
  if (fixed !== norm) for (const [c, n] of normalized) if (n.includes(fixed)) push(c)

  if (norm.length >= 3) {
    for (const group of PROBLEM_SYNONYMS) {
      if (!group.some((root) => root.startsWith(norm) || norm.includes(root))) continue
      for (const [c, n] of normalized) if (group.some((root) => n.includes(root))) push(c)
    }
  }
  if (norm.length >= 4) {
    const prefix = norm.slice(0, 4)
    for (const [c, n] of normalized) if (n.includes(prefix)) push(c)
  }
  return result.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Срок и значения по умолчанию
// ---------------------------------------------------------------------------

/** Через days календарных дней, 23:59 по местному времени, формат для datetime-local. */
export function deadlineIn(days: number, now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59`
}

/** Срок по умолчанию: 4 дня от приёма до конца дня, по факту 4–5 дней. */
export function defaultDeadline(now: Date = new Date()): string {
  return deadlineIn(4, now)
}

export const DEFAULT_APPEARANCE: string[] = ['Царапины', 'Потёртости']
export const DEFAULT_COMPLETE_SET: string[] = ['Без комплекта']
