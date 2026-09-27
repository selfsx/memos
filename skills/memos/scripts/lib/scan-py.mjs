import { isClosingOnly, lineIndex, nearSnippet, placementOf } from './text.mjs'

const DIRECTIVE = /^(?:type:|noqa\b|pragma\b|pylint:|fmt:|isort:|mypy:|pyright:|ruff:|nosec\b|flake8)/

export function pyCommentRanges(text) {
  const out = []
  const n = text.length
  let i = 0
  while (i < n) {
    const c = text[i]
    if (c === '#') {
      let j = text.indexOf('\n', i)
      if (j < 0) j = n
      if (text[j - 1] === '\r') j--
      out.push({ start: i, end: j })
      i = j
      continue
    }
    if (c === '"' || c === "'") {
      const triple = text.startsWith(c.repeat(3), i)
      const quote = triple ? c.repeat(3) : c
      let j = i + quote.length
      while (j < n) {
        if (text[j] === '\\') {
          j += 2
          continue
        }
        if (text.startsWith(quote, j)) {
          j += quote.length
          break
        }
        if (!triple && text[j] === '\n') break
        j++
      }
      i = j
      continue
    }
    i++
  }
  return out
}

const indentOf = (line) => line.match(/^[ \t]*/)[0].length
const DECL = /^(\s*)(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/
const ASSIGN = /^(\s*)([A-Za-z_]\w*)\s*(?::[^=]*)?=(?!=)/

function pyAnchor(lines, target) {
  const names = []
  let declLine = target
  while (declLine < lines.length && /^\s*@/.test(lines[declLine])) declLine++
  let exact = false
  let indent = indentOf(lines[target])
  const decl = lines[declLine]?.match(DECL)
  const assign = lines[target].match(ASSIGN)
  if (decl) {
    names.push(decl[2])
    exact = true
  } else if (assign) {
    names.push(assign[2])
    exact = true
  }
  for (let l = target - 1; l >= 0 && indent > 0; l--) {
    const line = lines[l]
    if (!line.trim() || /^\s*#/.test(line)) continue
    const ind = indentOf(line)
    if (ind < indent) {
      const m = line.match(DECL)
      if (m) names.unshift(m[2])
      indent = ind
    }
  }
  return { names, exact }
}

export function scanPy(path, text, keepRes = []) {
  const idx = lineIndex(text)
  const lines = Array.from({ length: idx.count }, (_, i) => idx.lineText(i))
  const codeLine = (l) => lines[l].trim() !== '' && !/^\s*#/.test(lines[l])
  const firstCodeLine = lines.findIndex((_, l) => codeLine(l))

  const items = pyCommentRanges(text).map((r) => {
    const raw = text.slice(r.start, r.end)
    const line = idx.lineOf(r.start)
    const body = raw.slice(1).trimStart()
    const isHeader = firstCodeLine < 0 || line < firstCodeLine
    let keep = null
    if (line === 0 && raw.startsWith('#!')) keep = 'shebang'
    else if (line <= 1 && /coding[:=]/.test(raw)) keep = 'directive'
    else if (DIRECTIVE.test(body)) keep = 'directive'
    else if (isHeader && /copyright|licen[cs]e|spdx/i.test(raw)) keep = 'license'
    else if (keepRes.some((re) => re.test(raw))) keep = 'config'
    return { ...r, raw, line, keep, isHeader, placement: placementOf(text, idx, r.start, r.end) }
  })

  const groups = []
  for (const item of items) {
    const prev = groups[groups.length - 1]
    const last = prev?.[prev.length - 1]
    const joinable =
      last && !item.keep && !last.keep && item.placement === 'own' && last.placement === 'own' && item.line === last.line + 1
    if (joinable) prev.push(item)
    else groups.push([item])
  }

  return groups.map((group) => {
    const first = group[0]
    const last = group[group.length - 1]
    const body = group.map((item) => item.raw.replace(/^# ?/, ''))
    const entry = {
      start: first.start,
      end: last.end,
      line: first.line + 1,
      endLine: last.line + 1,
      placement: first.placement,
      keep: first.keep,
      jsx: false,
      raw: text.slice(first.start, last.end),
      lines: body,
      decoration: !body.some((l) => /[\p{L}\p{N}]/u.test(l)),
      anchor: [],
      exact: false,
      near: null,
      hintLine: first.line + 1,
      hintPos: first.start,
      nearPos: null,
    }
    if (entry.keep) return entry
    let target = first.line
    if (entry.placement === 'own') {
      target = last.line + 1
      while (target < lines.length && !codeLine(target)) target++
      if (target >= lines.length) return entry
    }
    const { names, exact } = pyAnchor(lines, target)
    entry.anchor = names
    entry.exact = exact
    entry.hintLine = target + 1
    entry.hintPos = idx.lineStart(target)
    if (exact) {
      let declLine = target
      while (declLine < lines.length - 1 && /^\s*@/.test(lines[declLine])) declLine++
      entry.hintLine = declLine + 1
      entry.hintPos = idx.lineStart(declLine)
    }
    if (!exact && !(names.length === 0 && first.isHeader)) {
      let nearLine = target
      if (isClosingOnly(lines[nearLine])) nearLine = Math.max(0, first.line - 1)
      entry.near = nearSnippet(lines[nearLine])
      entry.nearPos = idx.lineStart(nearLine)
    }
    return entry
  })
}
