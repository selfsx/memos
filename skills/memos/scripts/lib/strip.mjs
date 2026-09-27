import { lineIndex } from './text.mjs'

export function stripComments(text, entries) {
  const idx = lineIndex(text)
  const endsWithNewline = text.endsWith('\n')
  const virtualLast = endsWithNewline ? idx.count - 1 : -1
  const removed = new Set()
  const own = entries.filter((e) => e.placement === 'own').sort((a, b) => a.line - b.line)
  for (const e of own) for (let l = e.line - 1; l <= e.endLine - 1; l++) removed.add(l)

  const blank = (l) => l >= 0 && l < idx.count && l !== virtualLast && !removed.has(l) && idx.lineText(l).trim() === ''
  for (const e of own) {
    let p = e.line - 2
    while (p >= 0 && removed.has(p)) p--
    let q = e.endLine
    while (q < idx.count && removed.has(q)) q++
    const atStart = p < 0
    const atEnd = q >= idx.count || q === virtualLast
    const prevLine = atStart ? '' : idx.lineText(p)
    const nextLine = atEnd ? '' : idx.lineText(q)
    const prevBlank = blank(p)
    const nextBlank = blank(q)
    const prevOpener = !atStart && /[{([:]\s*$/.test(prevLine)
    const nextCloser = !atEnd && /^\s*[})\]]/.test(nextLine)
    if (nextBlank && (atStart || prevBlank || prevOpener)) removed.add(q)
    else if (prevBlank && (atEnd || nextCloser)) removed.add(p)
  }

  const ranges = []
  const lines = [...removed].sort((a, b) => a - b)
  for (let i = 0; i < lines.length; ) {
    let j = i
    while (j + 1 < lines.length && lines[j + 1] === lines[j] + 1) j++
    const start = idx.lineStart(lines[i])
    const end = lines[j] + 1 < idx.count ? idx.lineStart(lines[j] + 1) : text.length
    ranges.push([start, end])
    i = j + 1
  }

  for (const e of entries) {
    if (e.placement === 'own') continue
    let start = e.start
    let end = e.end
    if (e.placement === 'trailing') {
      while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--
    } else {
      const after = end
      while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++
      if (end === after) while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) start--
    }
    ranges.push([start, end])
  }

  ranges.sort((a, b) => a[0] - b[0])
  const merged = []
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  let out = ''
  let cursor = 0
  for (const [start, end] of merged) {
    out += text.slice(cursor, start)
    cursor = end
  }
  out += text.slice(cursor)

  const map = (pos) => {
    let shift = 0
    for (const [start, end] of merged) {
      if (end <= pos) shift += end - start
      else if (start <= pos) return start - shift
      else break
    }
    return pos - shift
  }
  return { text: out, map }
}
