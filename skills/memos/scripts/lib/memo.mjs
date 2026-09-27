const HEADING = /^##\s+(.+?)\s*$/
const HINT = /^<!--\s*L(\d+)(?:\s*·\s*near:\s*`(.*)`)?\s*-->\s*$/
const FENCE = /^(```|~~~)/

export function parseMemo(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const memo = { source: null, front: [], sections: [] }
  let i = 0
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1)
    if (close > 0) {
      for (const line of lines.slice(1, close)) {
        const m = line.match(/^source:\s*(.+?)\s*$/)
        if (m && memo.source === null) memo.source = m[1].replace(/^["']|["']$/g, '')
        else memo.front.push(line)
      }
      i = close + 1
    }
  }
  let section = { anchor: null, notes: [] }
  memo.sections.push(section)
  let note = null
  let fenced = false
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (FENCE.test(line)) fenced = !fenced
    const heading = !fenced && line.match(HEADING)
    if (heading) {
      const text = heading[1]
      const tick = text.match(/^`([^`]+)`$/)
      section = { anchor: tick ? tick[1] : text, notes: [] }
      memo.sections.push(section)
      note = null
      continue
    }
    const hint = !fenced && line.match(HINT)
    if (hint) {
      note = { hint: { line: Number(hint[1]), near: hint[2] ?? null }, body: [] }
      section.notes.push(note)
      continue
    }
    if (!note) {
      if (!line.trim()) continue
      note = { hint: null, body: [] }
      section.notes.push(note)
    }
    note.body.push(line)
  }
  for (const s of memo.sections) {
    for (const n of s.notes) n.body = trimEdges(n.body).join('\n')
    s.notes = s.notes.filter((n) => n.hint || n.body)
  }
  memo.sections = memo.sections.filter((s, idx) => idx === 0 || s.anchor !== null)
  return memo
}

function trimEdges(lines) {
  let a = 0
  let b = lines.length
  while (a < b && !lines[a].trim()) a++
  while (b > a && !lines[b - 1].trim()) b--
  return lines.slice(a, b)
}

export function formatHint(hint) {
  return hint.near ? `<!-- L${hint.line} · near: \`${hint.near}\` -->` : `<!-- L${hint.line} -->`
}

export function serializeMemo(memo) {
  const out = ['---', `source: ${memo.source}`, ...memo.front, '---']
  for (const section of memo.sections) {
    if (section.anchor === null && section.notes.length === 0) continue
    out.push('')
    if (section.anchor !== null) out.push(`## \`${section.anchor}\``)
    section.notes.forEach((note, i) => {
      if (i > 0 || section.anchor !== null) out.push('')
      if (note.hint) out.push(formatHint(note.hint), '')
      if (note.body) out.push(note.body)
    })
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n'
}

export function emptyMemo(source) {
  return { source, front: [], sections: [{ anchor: null, notes: [] }] }
}

export function addNote(memo, anchor, note) {
  if (anchor === null) {
    memo.sections[0].notes.push(note)
    return
  }
  let section = memo.sections.find((s) => s.anchor === anchor)
  if (!section) {
    section = { anchor, notes: [] }
    memo.sections.push(section)
  }
  section.notes.push(note)
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/

function escapeLine(line) {
  if (/^#{1,6}(\s|$)/.test(line) || HINT.test(line) || FENCE.test(line)) return `\\${line}`
  return line
}

export function escapeBody(text) {
  const lines = text.split('\n')
  const out = []
  let inList = false
  let pre = []
  let afterFence = false
  const flush = () => {
    if (!pre.length) return
    const indent = Math.min(...pre.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length))
    const fence = pre.some((l) => l.includes('```')) ? '~~~' : '```'
    if (out.length && out[out.length - 1] !== '') out.push('')
    out.push(fence, ...pre.map((l) => l.slice(indent)), fence)
    pre = []
    afterFence = true
  }
  for (const line of lines) {
    if (!line.trim()) {
      flush()
      afterFence = false
      inList = false
      out.push('')
      continue
    }
    if (LIST_ITEM.test(line)) inList = true
    const indented = /^( {2,}|\t)/.test(line) && !LIST_ITEM.test(line) && !inList
    const aligned = /\S {3,}\S/.test(line.trim())
    if (indented || aligned) {
      pre.push(line)
      continue
    }
    flush()
    if (afterFence) out.push('')
    afterFence = false
    out.push(escapeLine(line))
  }
  flush()
  return out.join('\n')
}
