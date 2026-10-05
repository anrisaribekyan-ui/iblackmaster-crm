/** Печать документов: окно печати с HTML, без библиотек. */

export function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const BASE_STYLE = `
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { color: #171717; font: 14px/1.45 Arial, sans-serif; margin: 0 auto; max-width: 178mm; }
  h1 { font-size: 21px; margin: 0 0 5mm; text-align: center; }
  h2 { border-bottom: 1px solid #777; font-size: 14px; margin: 6mm 0 3mm; padding-bottom: 1mm; }
  p { margin: 1.5mm 0; }
  .muted { color: #555; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 14mm; margin-top: 22mm; }
  .signature { border-top: 1px solid #333; padding-top: 2mm; text-align: center; }
  table { width: 100%; border-collapse: collapse; margin-top: 3mm; }
  table th, table td { border: 1px solid #999; padding: 2mm; text-align: left; font-size: 13px; }
  table .num { text-align: right; }
  @media screen { body { margin: 12mm auto; padding: 12mm; border: 1px solid #ccc; } }
`

/** Открывает окно печати с HTML и сразу вызывает печать. bodyHtml — содержимое <body>. */
export function openPrint(title: string, bodyHtml: string): void {
  const printWindow = window.open('', '_blank')
  if (!printWindow) return
  printWindow.document.open()
  printWindow.document.write(
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${BASE_STYLE}</style></head><body>${bodyHtml}</body></html>`,
  )
  printWindow.document.close()
  printWindow.focus()
  printWindow.setTimeout(() => printWindow.print(), 100)
}
