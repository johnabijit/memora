// Conservative corrections for search vocabulary, not arbitrary artist names.
export function normalizeMusicQuery(value='') {
  const fixes={mobie:'movie',moive:'movie',mvoie:'movie',movi:'movie',movei:'movie',sogn:'song',sogns:'songs',snogs:'songs',musci:'music',muisc:'music',malaylam:'malayalam',malayalm:'malayalam',malayalum:'malayalam',tmail:'tamil',chirstian:'christian',christain:'christian',devotinal:'devotional'}
  return String(value).normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ').replace(/[a-z]+/g,word=>fixes[word]||word).slice(0,120)
}

export function musicQueryVariants(value='') {
  const query=normalizeMusicQuery(value)
  // Remove only generic media words; keep artist, language and faith qualifiers.
  const concise=query.replace(/\b(?:music|songs?|tracks?)\b/g,' ').replace(/\s+/g,' ').trim()
  const gospel=concise.replace(/\bchristian\b/g,'gospel')
  return [...new Set([query,concise,gospel].filter(Boolean))]
}
