import { quoteSegment } from './anchor.mjs'
import { dedent, isClosingOnly, lineIndex, nearSnippet, placementOf, trimBlankEdges } from './text.mjs'

const DIRECTIVE =
  /^(?:eslint|oxlint|jshint|jslint|jscs|tslint|stylelint|istanbul\b|c8\b|v8\b|biome-ignore|deno-lint-ignore|deno-fmt-ignore|prettier-ignore|dprint-ignore|global\b|globals\b|exported\b|webpack[A-Z]|@vite-ignore|@ts-|@jsx|@flow|@license|@preserve|@refresh|@vitest-environment|@jest-environment|[#@]\s*source(?:Mapping)?URL|<reference|<amd-|[#@]__(?:PURE|NO_SIDE_EFFECTS)__|noinspection|#?region\b|#?endregion\b)/

export function scriptKind(ts, path) {
  if (/\.tsx$/.test(path)) return ts.ScriptKind.TSX
  if (/\.[mc]?ts$/.test(path)) return ts.ScriptKind.TS
  if (/\.jsx$/.test(path)) return ts.ScriptKind.JSX
  return ts.ScriptKind.JS
}

export function parseJs(ts, path, text) {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(ts, path))
}

function isJsDocNode(ts, node) {
  return node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode
}

function collectRanges(ts, sf, text) {
  const seen = new Map()
  const visit = (node) => {
    if (isJsDocNode(ts, node)) return
    const children = node.getChildren(sf)
    if (children.length === 0) {
      if (node.kind === ts.SyntaxKind.JsxText) return
      const ranges = [
        ...(ts.getTrailingCommentRanges(text, node.pos) ?? []),
        ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
      ]
      for (const r of ranges) if (!seen.has(r.pos)) seen.set(r.pos, r)
      return
    }
    for (const child of children) visit(child)
  }
  visit(sf)
  return [...seen.values()].sort((a, b) => a.pos - b.pos)
}

export function leafTokens(ts, sf) {
  const out = []
  const visit = (node) => {
    if (isJsDocNode(ts, node)) return
    if (node.kind === ts.SyntaxKind.JsxExpression && !node.expression) return
    const children = node.getChildren(sf)
    if (children.length === 0) {
      let t = node.getText(sf)
      if (node.kind === ts.SyntaxKind.JsxText) {
        t = t.replace(/\s+/g, ' ').trim()
        if (!t) return
      }
      out.push(t)
      return
    }
    for (const child of children) visit(child)
  }
  visit(sf)
  return out
}

function identifierText(ts, name) {
  const K = ts.SyntaxKind
  if (!name) return null
  if (
    name.kind === K.Identifier ||
    name.kind === K.PrivateIdentifier ||
    name.kind === K.StringLiteral ||
    name.kind === K.NumericLiteral
  )
    return name.text
  return null
}

function nameOf(ts, node) {
  const K = ts.SyntaxKind
  switch (node.kind) {
    case K.Constructor:
      return 'constructor'
    case K.FunctionDeclaration:
    case K.ClassDeclaration:
      return node.name ? node.name.text : 'default'
    case K.VariableStatement: {
      const list = node.declarationList.declarations
      return list.length === 1 ? identifierText(ts, list[0].name) : null
    }
    case K.VariableDeclaration: {
      const list = node.parent
      if (list.declarations.length === 1 && list.parent.kind === K.VariableStatement) return null
      return identifierText(ts, node.name)
    }
    case K.InterfaceDeclaration:
    case K.TypeAliasDeclaration:
    case K.EnumDeclaration:
    case K.ModuleDeclaration:
    case K.MethodDeclaration:
    case K.MethodSignature:
    case K.PropertyDeclaration:
    case K.PropertySignature:
    case K.GetAccessor:
    case K.SetAccessor:
    case K.EnumMember:
    case K.PropertyAssignment:
    case K.ShorthandPropertyAssignment:
      return identifierText(ts, node.name)
    default:
      return null
  }
}

function callTitle(ts, node) {
  const [first, ...rest] = node.arguments
  if (!first || !(ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) return null
  if (!rest.some((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a))) return null
  return first.text
}

function ancestorsAt(sf, pos) {
  const chain = []
  let node = sf
  outer: for (;;) {
    chain.push(node)
    for (const child of node.getChildren(sf)) {
      if (child.getStart(sf) <= pos && pos < child.end) {
        node = child
        continue outer
      }
    }
    return chain
  }
}

function commentLines(raw) {
  if (raw.startsWith('//')) return [raw.replace(/^\/\/\/? ?/, '').replace(/\r$/, '')]
  const lines = raw
    .slice(2, -2)
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
  const rest = lines.slice(1)
  const starred = rest.filter((l) => l.trim()).every((l) => /^\s*\*/.test(l))
  const body = starred ? rest.map((l) => l.replace(/^\s*\* ?/, '')) : dedent(rest)
  return trimBlankEdges([lines[0].replace(/^\*?\s*/, '').trimEnd(), ...body])
}

function classify(raw, keepRes, isHeader) {
  if (raw.startsWith('/**') && raw !== '/**/') return 'doc'
  if (raw.startsWith('/*!')) return 'license'
  const body = raw.startsWith('//') ? raw.slice(2).trimStart() : raw.slice(2).replace(/^\*?\s*/, '')
  if (DIRECTIVE.test(body)) return 'directive'
  if (isHeader && /copyright|licen[cs]e|spdx/i.test(raw)) return 'license'
  if (keepRes.some((re) => re.test(raw))) return 'config'
  return null
}

function jsxWrapper(ts, sf, text, start, end) {
  let a = start - 1
  while (a >= 0 && /\s/.test(text[a])) a--
  let b = end
  while (b < text.length && /\s/.test(text[b])) b++
  if (text[a] !== '{' || text[b] !== '}') return null
  const chain = ancestorsAt(sf, a)
  const node = chain[chain.length - 2]
  if (node && node.kind === ts.SyntaxKind.JsxExpression && !node.expression) return { start: a, end: b + 1 }
  return null
}

export function scanJs(ts, path, text, keepRes = []) {
  const sf = parseJs(ts, path, text)
  const idx = lineIndex(text)
  const firstCode = ts.skipTrivia(text, 0)
  const items = collectRanges(ts, sf, text).map((r) => {
    const raw = text.slice(r.pos, r.end)
    const keep = classify(raw, keepRes, r.end <= firstCode)
    const wrap = keep ? null : jsxWrapper(ts, sf, text, r.pos, r.end)
    const start = wrap ? wrap.start : r.pos
    const end = wrap ? wrap.end : r.end
    return {
      start,
      end,
      raw,
      keep,
      jsx: Boolean(wrap),
      placement: placementOf(text, idx, start, end),
      line: idx.lineOf(start),
      endLine: idx.lineOf(end),
    }
  })

  const groups = []
  for (const item of items) {
    const prev = groups[groups.length - 1]
    const last = prev?.items[prev.items.length - 1]
    const joinable =
      prev &&
      !item.keep &&
      !last.keep &&
      !item.jsx &&
      !last.jsx &&
      item.placement === 'own' &&
      last.placement === 'own' &&
      item.line === last.endLine + 1 &&
      text.slice(last.end, item.start).trim() === ''
    if (joinable) prev.items.push(item)
    else groups.push({ items: [item] })
  }

  return groups.map(({ items: group }) => {
    const first = group[0]
    const last = group[group.length - 1]
    const lines = group.flatMap((item) => commentLines(item.raw))
    const entry = {
      start: first.start,
      end: last.end,
      line: first.line + 1,
      endLine: last.endLine + 1,
      placement: first.placement === 'own' ? 'own' : first.placement,
      keep: first.keep,
      jsx: first.jsx,
      raw: text.slice(first.start, last.end),
      lines,
      decoration: !lines.some((l) => /[\p{L}\p{N}]/u.test(l)),
      anchor: [],
      exact: false,
      near: null,
      hintLine: first.line + 1,
      hintPos: first.start,
      nearPos: null,
    }
    if (entry.keep) return entry

    let target
    if (entry.placement === 'trailing') {
      const ls = idx.lineStart(first.line)
      target = ls + text.slice(ls).match(/^[ \t]*/)[0].length
    } else {
      target = ts.skipTrivia(text, last.end)
    }
    if (target >= text.length) {
      entry.hintLine = first.line + 1
      return entry
    }
    const targetLine = idx.lineOf(target)
    const chain = ancestorsAt(sf, target)
    let innermost = null
    let transparent = null
    for (const node of chain) {
      if (node.parent && ts.isFunctionLike(node.parent) && node.parent.body === node && node.parent !== transparent) break
      const title = ts.isCallExpression(node) ? callTitle(ts, node) : null
      if (title !== null) {
        entry.anchor.push(quoteSegment(title))
        innermost = node
        transparent = node.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a)) ?? null
        continue
      }
      const name = nameOf(ts, node)
      if (name !== null) {
        entry.anchor.push(name)
        innermost = node
      }
    }
    entry.exact = innermost !== null && idx.lineOf(innermost.getStart(sf)) === targetLine
    entry.hintLine = targetLine + 1
    entry.hintPos = target
    if (entry.exact) {
      const nameNode = ts.isVariableStatement(innermost)
        ? innermost.declarationList.declarations[0].name
        : ts.isCallExpression(innermost)
          ? innermost.arguments[0]
          : innermost.name
      if (nameNode) {
        entry.hintPos = nameNode.getStart(sf)
        entry.hintLine = idx.lineOf(entry.hintPos) + 1
      }
    }
    if (!entry.exact) {
      const isHeader = entry.anchor.length === 0 && first.end <= firstCode
      if (!isHeader) {
        let nearLine = targetLine
        if (isClosingOnly(idx.lineText(nearLine))) {
          nearLine = first.line - 1
          while (nearLine > 0 && !idx.lineText(nearLine).trim()) nearLine--
          entry.hintLine = nearLine + 1
          entry.hintPos = idx.lineStart(nearLine)
        }
        entry.near = nearSnippet(idx.lineText(nearLine))
        entry.nearPos = idx.lineStart(nearLine)
      }
    }
    return entry
  })
}
