'use strict'

// Lightweight, dependency-free, query-focused retrieval for authenticated Memora evidence.
// Important: This ranks evidence already fetched under the caller's Supabase JWT/RLS.
// It does NOT authorize data access, generate embeddings, or verify model claims.
const STOP = new Set('a an and are as at be but by can did do does for from had has have how i in is it me my of on or our the their this to was were what when where which who why with you your about tell please know show find'.split(' '))

function terms(input) {
  return [...new Set(String(input || '').toLocaleLowerCase().match(/[\\p{L}\\p{N}]+/gu) || [])]
    .filter(t => t.length > 1 && !STOP.has(t))
}
function safeText(input, limit) {
  return String(input || '').replace(/[\\u0000-\\u001f\\u007f]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, limit)
}
function rank(question, evidence) {
  const tokens = terms(question)
  return evidence.map((item, index) => {
    const title = safeText(item.title, 260)
    const content = safeText(item.content, 2500)
    const titleTerms = new Set(terms(title))
    const bodyTerms = new Set(terms(content))
    let hits = 0
    for (const token of tokens) hits += (titleTerms.has(token) ? 3 : 0) + (bodyTerms.has(token) ? 1 : 0)
    const relevance = tokens.length ? hits / (tokens.length * 4) : 0
    const priority = item.kind === 'fact' ? 0.15 : 0
    return { item: { ...item, title, content }, index, score: relevance + priority, hits }
  }).sort((a, b) => b.score - a.score || a.index - b.index)
}
function selectEvidence(question, evidence, options = {}) {
  const limit = Math.max(1, Math.min(20, Number(options.limit) || 10))
  const maxChars = Math.max(500, Math.min(24000, Number(options.maxChars) || 8500))
  const candidates = rank(question, Array.isArray(evidence) ? evidence : [])
  const chosen = []
  const seen = new Set()
  let total = 0
  for (const row of candidates) {
    if (chosen.length >= limit || total >= maxChars) break
    // If the query has meaningful terms, exclude irrelevant memories instead of
    // flooding the model with recent unrelated private context.
    if (terms(question).length && !row.hits && row.item.kind !== 'fact') continue
    const id = safeText(row.item.id, 90)
    const key = id || row.item.content.toLocaleLowerCase()
    if (!row.item.content || seen.has(key)) continue
    const allowed = maxChars - total
    if (allowed < 80) break
    const item = {...row.item, content: row.item.content.slice(0, allowed)}
    chosen.push(item)
    seen.add(key)
    total += item.content.length + item.title.length + 48
  }
  const context = chosen.map(x => `[${x.id}] ${safeText(x.kind, 40)}: ${x.title || 'Saved memory'} (${safeText(x.occurred_at, 45) || 'date unknown'})\\n${x.content}`).join('\\n\\n')
  return {
    context,
    items: chosen,
    sources: chosen.map(x => ({ id: x.id, kind: x.kind, title: x.title, occurred_at: x.occurred_at || null })),
    hasEvidence: chosen.length > 0
  }
}

// Reciprocal-rank fusion for a later pgvector + PostgreSQL full-text implementation.
// Pass only already-authorized, user-scoped results into this function.
function fuseRanks(keyword = [], semantic = [], k = 50, limit = 20) {
  const merged = new Map()
  for (const [origin, entries] of [['keyword', keyword], ['semantic', semantic]]) {
    for (const [index, item] of entries.entries()) {
      if (!item || !item.id) continue
      const key = String(item.id)
      const entry = merged.get(key) || { ...item, score: 0, matchedBy: [] }
      entry.score += 1 / (Math.max(1, k) + index + 1)
      entry.matchedBy.push(origin)
      merged.set(key, entry)
    }
  }
  return [...merged.values()].sort((a,b) => b.score-a.score).slice(0,limit)
}
module.exports = { selectEvidence, fuseRanks, terms }
