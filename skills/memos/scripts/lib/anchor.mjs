export function quoteSegment(title) {
  return `"${title.replace(/\s+/g, ' ')}"`
}

export function segmentsOf(anchor) {
  const out = []
  let i = 0
  while (i < anchor.length) {
    if (anchor[i] === '"') {
      let j = i + 1
      while (j < anchor.length && !(anchor[j] === '"' && (j + 1 === anchor.length || anchor[j + 1] === '.'))) j++
      out.push(anchor.slice(i, j + 1))
      i = j + 2
    } else {
      let j = anchor.indexOf('.', i)
      if (j < 0) j = anchor.length
      if (j > i) out.push(anchor.slice(i, j))
      i = j + 1
    }
  }
  return out
}

export const isQuoted = (segment) => segment.length > 1 && segment.startsWith('"') && segment.endsWith('"')
export const unquote = (segment) => (isQuoted(segment) ? segment.slice(1, -1) : segment)
