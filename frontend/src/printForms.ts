/** Бланки для печати: квитанция, проверка неисправностей, акт, отказной лист. Чистые функции: данные → HTML. */
import { escapeHtml } from './print'
import type { ChecklistValues } from './components/Checklist'

export type FormPosition = {
  name: string
  quantity: string
  price: string
  total: string
  guaranteeDays: number
}

export type FormData = {
  number: string
  date: string // дд.мм.гггг
  shop: { name: string; address: string; phones: string }
  customer: { name: string; phones: string }
  master: string
  manager: string
  device: string
  serial: string
  look: string // внешний вид
  completeSet: string
  problems: string
  note: string
  approximatePrice: string
  prepaid: string // «Нет» или сумма
  ready: string // срок готовности
  positions: FormPosition[]
  total: string
  paid: string
  discount: string
  trackQr: string // SVG для страницы отслеживания, может быть пустым
  checkIn: ChecklistValues // проверка при приёме (пункты из настроек)
  checkOut: ChecklistValues // проверка при выдаче
  signatureIn?: string // подпись клиента при приёме (data URL)
  signatureOut?: string // подпись клиента при выдаче (data URL)
}

const e = escapeHtml

function rub(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`
}

/** Сумма прописью, целые рубли (в CRM деньги без копеек). */
export function rublesInWords(value: number): string {
  const units = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
  const teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать']
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто']
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот']
  const plural = (n: number, forms: [string, string, string]) => {
    const mod100 = n % 100
    if (mod100 > 10 && mod100 < 20) return forms[2]
    const mod10 = n % 10
    if (mod10 === 1) return forms[0]
    if (mod10 > 1 && mod10 < 5) return forms[1]
    return forms[2]
  }
  const triplet = (n: number, feminine: boolean) => {
    const parts = [hundreds[Math.floor(n / 100)]]
    const rest = n % 100
    if (rest >= 10 && rest < 20) parts.push(teens[rest - 10])
    else {
      parts.push(tens[Math.floor(rest / 10)])
      const unit = rest % 10
      parts.push(feminine && unit === 1 ? 'одна' : feminine && unit === 2 ? 'две' : units[unit])
    }
    return parts.filter(Boolean).join(' ')
  }
  const amount = Math.max(0, Math.round(value))
  const millions = Math.floor(amount / 1_000_000)
  const thousands = Math.floor(amount / 1000) % 1000
  const rest = amount % 1000
  const words: string[] = []
  if (millions) words.push(triplet(millions, false), plural(millions, ['миллион', 'миллиона', 'миллионов']))
  if (thousands) words.push(triplet(thousands, true), plural(thousands, ['тысяча', 'тысячи', 'тысяч']))
  if (rest || !amount) words.push(rest ? triplet(rest, false) : 'ноль')
  const text = words.join(' ')
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} ${plural(amount, ['рубль', 'рубля', 'рублей'])}`
}

const TERMS = (storagePerDay: string) => [
  'Технический центр не несёт ответственности за возможную потерю данных в памяти устройства, связанную с заменой плат, установкой программного обеспечения, заменой носителя информации.',
  'Заказчик принимает на себя риск возможной полной или частичной утраты работоспособности устройства в процессе ремонта (тепловой обработки), в случае грубых нарушений пользователем условий эксплуатации, наличия следов попадания токопроводящей жидкости (коррозии), либо механических повреждений.',
  'На восстановленные после попадания жидкости на устройство гарантия не распространяется и не продлевается.',
  `Срок бесплатного хранения устройства составляет 30 дней с момента приёма его в ремонт. В случае, если по истечении указанного срока клиентом не заявлено требование о выдаче устройства, оно принимается на ответственное хранение. Стоимость услуг по ответственному хранению составляет ${storagePerDay} руб. в сутки. Максимальный срок ответственного хранения составляет 30 дней. В случае, если в течение указанного срока Клиент не требует возврата устройства (либо с Клиентом не представляется возможным связаться по указанному в квитанции телефону), устройство утилизируется без компенсации его стоимости клиенту.`,
  'В случае отказа заказчика от ремонта устройства стоимость диагностики неисправности платная.',
  'В случае утери квитанции устройство выдаётся по предъявлению паспорта на имя заказчика.',
]

const CHECKS = [
  'Камера передняя / микрофон',
  'Камера задняя / микрофон',
  'Face ID / Touch ID',
  'Громкость (шлейф) / шлейф On/Off',
  'Слуховой динамик / громкая связь / датчик',
  'Микрофон (диктофон)',
  'Индукционная зарядка / зарядка',
  'Сеть (с SIM) / Wi-Fi',
]

const val = (text: string) => (text ? e(text) : '<span class="empty">—</span>')

const head = (d: FormData, title: string, tag = '', sub = 'Сервисный центр') => `
  <header class="head">
    <div class="brand"><div class="mark">iB</div><div><div class="brand-name">iBlackMaster</div><div class="brand-sub">${e(sub)}</div></div></div>
    <div class="doc-title">${tag ? `<span class="copy-tag">${tag}</span><br>` : ''}<h1>${title}</h1><div class="num">№ ${e(d.number)} от ${e(d.date)}</div></div>
  </header>`

const parties = (d: FormData) => `
  <div class="cols">
    <section class="card"><h3>Исполнитель</h3><dl class="kv"><dt>Название</dt><dd>${val(d.shop.name)}</dd><dt>Адрес</dt><dd>${val(d.shop.address)}</dd><dt>Телефон</dt><dd>${val(d.shop.phones)}</dd></dl></section>
    <section class="card"><h3>Заказчик</h3><dl class="kv"><dt>Имя</dt><dd>${val(d.customer.name)}</dd><dt>Телефон</dt><dd>${val(d.customer.phones)}</dd></dl></section>
  </div>`

const signImg = (dataUrl?: string) =>
  dataUrl && dataUrl.startsWith('data:image/') ? `<img class="sig" src="${dataUrl}" alt="">` : ''

const sign = (left: string, right: string, rightSignature?: string) => `
  <div class="sign">
    <div><div class="line"></div><div class="cap"><span>${left}</span><span>подпись</span></div></div>
    <div><div class="line">${signImg(rightSignature)}</div><div class="cap"><span>${right}</span><span>подпись</span></div></div>
  </div>`

function receiptHalf(d: FormData, tag: string): string {
  const terms = TERMS('___')
    .map((text, index) => `<p><b>${index + 1}.</b> ${e(text)}</p>`)
    .join('')
  const estimate = /^[\d\s\-–+.,]+$/.test(d.approximatePrice) ? `${d.approximatePrice} ₽` : d.approximatePrice
  return `<div class="half">
    ${head(d, 'Квитанция о приёме', tag, [d.shop.name, d.shop.address, d.shop.phones].filter(Boolean).join(' · '))}
    <div class="cols">
      <section class="card"><h3>Заказчик</h3><dl class="kv"><dt>Имя</dt><dd>${val(d.customer.name)}</dd><dt>Телефон</dt><dd>${val(d.customer.phones)}</dd><dt>Мастер</dt><dd>${val(d.master)}</dd></dl></section>
      <section class="card"><h3>Сроки и оплата</h3><dl class="kv"><dt>Готовность</dt><dd>${val(d.ready)}</dd><dt>Предоплата</dt><dd>${val(d.prepaid)}</dd><dt>Примечание</dt><dd>${val(d.note)}</dd></dl></section>
      <section class="card wide"><h3>Устройство</h3><div class="kv2"><dl class="kv"><dt>Модель</dt><dd>${val(d.device)}</dd><dt>SN / IMEI</dt><dd>${val(d.serial)}</dd></dl><dl class="kv"><dt>Комплектация</dt><dd>${val(d.completeSet)}</dd><dt>Внешний вид</dt><dd>${val(d.look)}</dd></dl></div></section>
    </div>
    <div class="price">
      <section class="card tint" style="flex:1.2"><h3>Причина обращения (со слов заказчика)</h3><div>${val(d.problems)}</div></section>
      <section class="card" style="flex:1"><h3>Ориентировочная стоимость</h3><div class="big">${val(estimate)}</div></section>
      ${d.trackQr ? `<section class="card qr"><div class="qr-img">${d.trackQr}</div><div class="qr-cap">Следите за ремонтом: наведите камеру</div></section>` : ''}
    </div>
    <div class="terms">${terms}</div>
    ${sign(`Исполнитель · ${e(d.manager || d.master)}`, `С условиями ознакомлен и согласен · ${e(d.customer.name)}`, d.signatureIn)}
  </div>`
}

export function receiptHtml(d: FormData): string {
  return `<section class="sheet receipt">
    ${receiptHalf(d, 'Экземпляр сервиса')}
    <div class="cut">✂ линия отреза</div>
    ${receiptHalf(d, 'Экземпляр клиента')}
  </section>`
}

const MARK_TEXT = { ok: '✓ работает', fail: '✗ не работает', na: '— не проверить' } as const

/** Пункты проверки: из заказа (настройки «Чек-лист»), а если отметок нет — пустой бланк для ручного заполнения. */
function checkItems(d: FormData): string[] {
  return Array.from(new Set([...Object.keys(d.checkIn), ...Object.keys(d.checkOut)]))
}

function markCell(mark: string | undefined): string {
  if (mark === 'ok' || mark === 'fail' || mark === 'na') {
    return `<td class="c cm ${mark}">${MARK_TEXT[mark]}</td>`
  }
  return '<td class="c"><span class="dash">—</span></td>'
}

export function checklistHtml(d: FormData): string {
  const items = checkItems(d)
  const table = items.length
    ? `<table class="check">
      <thead><tr><th>Узел</th><th class="c w">При приёме</th><th class="c w">При выдаче</th></tr></thead>
      <tbody>${items.map((name) => `<tr><td>${e(name)}</td>${markCell(d.checkIn[name])}${markCell(d.checkOut[name])}</tr>`).join('')}</tbody>
    </table>`
    : `<table class="check">
      <thead><tr><th>Узел</th><th class="c">Исправен</th><th class="c">Не исправен</th></tr></thead>
      <tbody>
        <tr><td>Пароль блокировки экрана</td><td colspan="2"><span class="write"></span></td></tr>
        ${CHECKS.map((name) => `<tr><td>${e(name)}</td><td class="c"><span class="box"></span></td><td class="c"><span class="box"></span></td></tr>`).join('')}
        <tr><td>Ошибки (сообщения) в основных настройках</td><td class="c"><span class="box"></span><br><small>отсутствуют</small></td><td class="c"><span class="box"></span><br><small>присутствуют</small></td></tr>
      </tbody>
    </table>`
  return `<section class="sheet">
    ${head(d, 'Проверка неисправностей')}
    ${parties(d)}
    <div class="cols"><section class="card wide"><h3>Устройство</h3><div>${val(d.device)}</div></section></div>
    ${table}
    <div class="notes"><div class="card"><h3>Комментарии</h3></div><div class="area"></div></div>
    ${sign('Проверил · мастер', `С проверкой ознакомился, согласен · ${e(d.customer.name)}`, d.signatureIn)}
  </section>`
}

function positionsTable(d: FormData): string {
  const rows = d.positions.length
    ? d.positions
        .map(
          (p, index) => `<tr><td>${index + 1}</td><td>${e(p.name)}</td><td>${p.guaranteeDays ? `${p.guaranteeDays} дн.` : '—'}</td><td class="r">${e(Number(p.quantity).toLocaleString('ru-RU', { maximumFractionDigits: 3 }))}</td><td class="r">${e(rub(p.price))}</td><td class="r">${e(rub(p.total))}</td></tr>`,
        )
        .join('')
    : '<tr class="empty"><td colspan="6">Позиции не добавлены</td></tr>'
  return `<table class="items"><thead><tr><th>№</th><th>Наименование товаров и услуг</th><th>Гарантия</th><th class="r">Кол-во</th><th class="r">Цена</th><th class="r">Сумма</th></tr></thead><tbody>${rows}</tbody></table>`
}

function totalsBlock(d: FormData, withPaid: boolean): string {
  const discount = Number(d.discount || 0)
  return `<div class="totals">
      ${discount > 0 ? `<div><span>Скидка</span><span>${e(rub(discount))}</span></div>` : ''}
      <div class="grand"><span>Итого</span><span>${e(rub(d.total))}</span></div>
      ${withPaid ? `<div><span>Оплачено</span><span>${e(rub(d.paid))}</span></div>` : ''}
    </div>
    <div class="words">Всего наименований ${d.positions.length}, на сумму ${e(rub(d.total))}<b>${e(rublesInWords(Number(d.total || 0)))}</b></div>`
}

function actCheck(d: FormData): string {
  const items = checkItems(d)
  if (!items.length) return ''
  const rows = items
    .map((name) => `<tr><td>${e(name)}</td>${markCell(d.checkIn[name])}${markCell(d.checkOut[name])}</tr>`)
    .join('')
  return `<table class="check compact"><thead><tr><th>Проверка устройства</th><th class="c w">При приёме</th><th class="c w">При выдаче</th></tr></thead><tbody>${rows}</tbody></table>`
}

export function actHtml(d: FormData): string {
  return `<section class="sheet">
    ${head(d, 'Акт сдачи-приёмки')}
    ${parties(d)}
    <div class="cols"><section class="card wide"><h3>Устройство</h3><div>${val([d.device, d.serial ? `SN / IMEI: ${d.serial}` : ''].filter(Boolean).join(' · '))}</div></section></div>
    ${positionsTable(d)}
    ${totalsBlock(d, true)}
    ${actCheck(d)}
    <div class="verdict"><h3>Вердикт</h3>Вышеперечисленные услуги выполнены полностью и в срок. Заказчик претензий по объёму, качеству и срокам оказания услуг не имеет.</div>
    ${sign(`Исполнитель · ${e(d.master || d.manager)}`, `Заказчик · ${e(d.customer.name)}`, d.signatureOut)}
    <div class="promo">
      <img src="/print/store-qr.png" alt="QR-код телеграм-канала @iblackmaster_store">
      <div><h4>Наведи камеру — попади в наш телеграм-магазин</h4><p>Канал с техникой: @iblackmaster_store</p><span class="offer">Пришли фото квитанции менеджеру — скидка 500 ₽ на первый заказ</span></div>
    </div>
  </section>`
}

export function refusalHtml(d: FormData): string {
  return `<section class="sheet">
    ${head(d, 'Отказной лист')}
    ${parties(d)}
    <div class="cols"><section class="card wide"><h3>Устройство</h3><div>${val(d.device)}</div></section></div>
    ${positionsTable(d)}
    ${totalsBlock(d, false)}
    <div class="notes"><div class="card"><h3>Причина отказа в ремонте</h3></div><div class="area" style="min-height:22mm"></div></div>
    <div class="terms one">
      <p><b>1.</b> При отказе от ремонта Заказчик обязуется оплатить оказанные услуги и установленные Исполнителем товары до момента наступления такого отказа.</p>
      <p><b>2.</b> Перечень оказанных услуг и установленных товаров указан в таблице выше.</p>
    </div>
    ${sign(`Исполнитель · ${e(d.manager || d.master)}`, `Заказчик · ${e(d.customer.name)}`)}
  </section>`
}

/** Стиль бланков. Фиксированная монохромная палитра: печать не зависит от темы интерфейса. */
export const FORMS_STYLE = `
  :root { --ink:#0f1115; --ink-2:#4a505c; --ink-3:#8a909c; --line:#d9dce2; --tint:#f4f5f7; }
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { background: #e9eaee; }
  body { color: var(--ink); font: 10.5pt/1.45 "Inter","SF Pro Text",-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { width: 210mm; height: 297mm; margin: 12px auto; padding: 12mm 14mm; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.12); overflow: hidden; break-after: page; page-break-after: always; }
  .sheet:last-child { break-after: auto; page-break-after: auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 10px; border-bottom: 2px solid var(--ink); }
  .brand { display: flex; align-items: center; gap: 10px; }
  .mark { width: 34px; height: 34px; border-radius: 9px; background: var(--ink); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 15px; letter-spacing: -.02em; }
  .brand-name { font-weight: 700; font-size: 13pt; letter-spacing: -.01em; line-height: 1.1; }
  .brand-sub { font-size: 8.5pt; color: var(--ink-2); max-width: 105mm; }
  .receipt .brand-sub { font-size: 7pt; max-width: 125mm; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 17pt; font-weight: 700; letter-spacing: -.02em; line-height: 1.1; }
  .doc-title .num { font-size: 9.5pt; color: var(--ink-2); margin-top: 3px; font-variant-numeric: tabular-nums; }
  .copy-tag { display: inline-block; margin-bottom: 4px; padding: 2px 8px; border: 1px solid var(--ink); border-radius: 99px; font-size: 7.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; margin-top: 10px; }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 8px 11px; }
  .card.tint { background: var(--tint); border-color: transparent; }
  .card h3 { font-size: 7.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: .07em; color: var(--ink-3); margin-bottom: 4px; }
  .kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; font-size: 9.5pt; }
  .kv dt { color: var(--ink-2); }
  .kv dd { font-weight: 500; font-variant-numeric: tabular-nums; }
  .empty { color: var(--ink-3); font-weight: 400; }
  .wide { grid-column: 1 / -1; }
  .kv2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
  .price { display: flex; gap: 10px; margin-top: 10px; }
  .big { font-size: 13pt; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .qr { width: 22mm; flex: none; text-align: center; padding: 3px; }
  .qr-img { width: 13mm; height: 13mm; margin: 0 auto; }
  .qr-img svg { width: 100%; height: 100%; display: block; }
  .qr-cap { font-size: 5.4pt; line-height: 1.2; color: var(--ink-2); margin-top: 2px; }
  .terms { margin-top: 10px; font-size: 7.4pt; line-height: 1.38; color: var(--ink-2); column-count: 2; column-gap: 14px; text-align: justify; hyphens: auto; }
  .terms.one { column-count: 1; font-size: 8.5pt; }
  .terms p { margin-bottom: 3px; break-inside: avoid; }
  .terms b { color: var(--ink); }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin-top: 12px; }
  .sign .line { border-bottom: 1px solid var(--ink); height: 20px; }
  .sign .cap { font-size: 7.5pt; color: var(--ink-2); margin-top: 3px; display: flex; justify-content: space-between; gap: 6px; }
  .consent { font-size: 7.5pt; color: var(--ink-2); margin-top: 6px; }
  .cut { display: flex; align-items: center; gap: 8px; margin: 3mm 0; color: var(--ink-3); font-size: 8pt; }
  .cut::before, .cut::after { content: ""; flex: 1; border-top: 1px dashed var(--ink-3); }
  .sheet.receipt { padding: 9mm 14mm; }
  .receipt .half { height: 134mm; display: flex; flex-direction: column; overflow: hidden; }
  .receipt .head { padding-bottom: 6px; }
  .receipt .mark { width: 28px; height: 28px; font-size: 12px; border-radius: 7px; }
  .receipt .doc-title h1 { font-size: 14pt; }
  .receipt .cols { margin-top: 5px; gap: 5px 10px; }
  .receipt .card { padding: 5px 9px; }
  .receipt .card h3 { margin-bottom: 2px; font-size: 7pt; }
  .receipt .kv { font-size: 8.8pt; gap: 1px 10px; }
  .receipt .price { margin-top: 5px; gap: 6px; }
  .receipt .big { font-size: 11.5pt; }
  .receipt .terms { font-size: 6.4pt; line-height: 1.26; margin-top: 5px; column-gap: 10px; }
  .receipt .terms p { margin-bottom: 2px; }
  .receipt .sign { margin-top: auto; padding-top: 4px; }
  .receipt .sign .line { height: 12px; }
  .receipt .consent { margin-top: 3px; font-size: 7pt; }
  .check { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 10pt; }
  .check th { font-size: 7.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: .07em; color: var(--ink-3); text-align: left; padding: 6px 8px; border-bottom: 1.5px solid var(--ink); }
  .check th.c, .check td.c { text-align: center; width: 90px; }
  .check td { padding: 9px 8px; border-bottom: 1px solid var(--line); }
  .check tr:nth-child(even) td { background: #fafafb; }
  .check small { font-size: 7pt; color: var(--ink-2); }
  .check th.w, .check td.cm { width: 34mm; }
  .check .cm { font-size: 9pt; white-space: nowrap; }
  .check .cm.fail { font-weight: 700; }
  .check .cm.na { color: var(--ink-2); }
  .check .dash { color: var(--ink-3); }
  .check.compact { font-size: 8.5pt; margin-top: 10px; }
  .check.compact td { padding: 4px 8px; }
  .box { display: inline-block; width: 15px; height: 15px; border: 1.4px solid var(--ink); border-radius: 4px; vertical-align: middle; }
  .sign .line { position: relative; }
  .sig { position: absolute; right: 4px; bottom: 1px; height: 10mm; max-width: 60mm; object-fit: contain; }
  .write { display: block; border-bottom: 1px solid var(--ink-3); height: 14px; }
  .notes { margin-top: 12px; }
  .notes .area { min-height: 30mm; border: 1px solid var(--line); border-radius: 8px; margin-top: 4px; }
  .items { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 9.5pt; font-variant-numeric: tabular-nums; }
  .items th { font-size: 7.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: .07em; color: var(--ink-3); text-align: left; padding: 6px 8px; border-bottom: 1.5px solid var(--ink); }
  .items td { padding: 8px; border-bottom: 1px solid var(--line); }
  .items .r { text-align: right; }
  .items .empty td { color: var(--ink-3); text-align: center; padding: 14px; }
  .totals { margin: 10px 0 0 auto; width: 66mm; font-size: 9.5pt; font-variant-numeric: tabular-nums; }
  .totals div { display: flex; justify-content: space-between; padding: 3px 0; }
  .totals .grand { border-top: 1.5px solid var(--ink); margin-top: 3px; padding-top: 6px; font-weight: 700; font-size: 11.5pt; }
  .words { margin-top: 10px; font-size: 9.5pt; }
  .words b { display: block; font-size: 10.5pt; }
  .verdict { margin-top: 12px; padding: 10px 12px; background: var(--tint); border-radius: 8px; font-size: 9.5pt; }
  .verdict h3 { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .07em; color: var(--ink-3); margin-bottom: 3px; }
  .promo { display: grid; grid-template-columns: 40mm 1fr; gap: 14px; align-items: center; margin-top: 16px; border: 1px solid var(--line); border-radius: 12px; padding: 10px; }
  .promo img { width: 40mm; height: 40mm; border-radius: 8px; display: block; }
  .promo h4 { font-size: 13pt; line-height: 1.2; letter-spacing: -.01em; }
  .promo p { margin-top: 6px; font-size: 9.5pt; color: var(--ink-2); }
  .promo .offer { display: inline-block; margin-top: 8px; padding: 4px 10px; background: var(--ink); color: #fff; border-radius: 99px; font-weight: 600; font-size: 9.5pt; }
  @media print { html { background: #fff; } .sheet { margin: 0; box-shadow: none; } }
`
