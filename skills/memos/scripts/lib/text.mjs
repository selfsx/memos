export function lineIndex(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  const lineOf = (pos) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  const lineStart = (line) => starts[line]
  const lineEnd = (line) => (line + 1 < starts.length ? starts[line + 1] - 1 : text.length)
  const lineText = (line) => text.slice(lineStart(line), lineEnd(line)).replace(/\r$/, '')
  return { lineOf, lineStart, lineEnd, lineText, count: starts.length }
}

export function placementOf(text, idx, start, end) {
  const startLine = idx.lineOf(start)
  const endLine = idx.lineOf(end)
  const before = text.slice(idx.lineStart(startLine), start)
  const after = text.slice(end, idx.lineEnd(endLine))
  if (before.trim() === '' && after.trim() === '') return 'own'
  if (after.trim() === '') return 'trailing'
  return 'inline'
}

export function nearSnippet(line) {
  const trimmed = line.trim().replace(/\s+/g, ' ').replace(/`/g, "'").replace(/-->/g, '-- >')
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed
}

export function isClosingOnly(line) {
  return /^[\s)\]}>;,]*$/.test(line) && line.trim() !== ''
}

export function dedent(lines) {
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length)
  const min = indents.length ? Math.min(...indents) : 0
  return lines.map((l) => l.slice(min))
}

export function trimBlankEdges(lines) {
  let a = 0
  let b = lines.length
  while (a < b && !lines[a].trim()) a++
  while (b > a && !lines[b - 1].trim()) b--
  return lines.slice(a, b)
}

const TAG = /^[A-Z][A-Z0-9_-]{1,15}(\([^)]*\))?:/

export function joinCommentLines(lines) {
  const out = []
  for (const line of lines) {
    if (out.length && TAG.test(line.trim()) && out[out.length - 1] !== '') out.push('')
    out.push(line.replace(/\s+$/, ''))
  }
  return trimBlankEdges(out).join('\n')
}
