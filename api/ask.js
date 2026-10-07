const SUPABASE_URL = 'https://ueinbsvqihczmxpkctcq.supabase.co'
const SUPABASE_KEY = 'sb_publishable_8j0W8nm-xmK1srJmmbiJdQ_FCzwbukF'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function trimText(value, max = 4000) {
  return String(value || '').replace(/\u0000/g, '').slice(0, max)
}

async function supabaseFetch(path, token, options = {}) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${token}`,
    ...options.headers,
  }
  const response = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Supabase request failed (${response.status}): ${detail.slice(0, 220)}`)
  }
  if (response.status === 204) return null
  return await response.json()
}

async function verifyUser(token) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
  })
  if (!response.ok) return null
  return await response.json()
}

function compactRows(rows, mapper, limit = 20) {
  return (rows || []).slice(0, limit).map(mapper).filter(Boolean)
}

function extractGatewayText(result) {
  if (typeof result?.output_text === 'string' && result.output_text.trim()) return result.output_text.trim()
  const parts = []
  for (const item of result?.output || []) {
    for (const content of item?.content || []) {
      if ((content?.type === 'output_text' || content?.type === 'text') && content?.text) parts.push(content.text)
    }
  }
  return parts.join('\n').trim()
}

function shouldUseImage(question, history) {
  const recent = [question, ...(history || []).slice(-6).map(x => x?.text || '')].join(' ').toLowerCase()
  return /\b(image|img|photo|picture|screenshot|screen shot|attachment|attached|phone number|mobile number|number in it|in the image|in it|what does it say|read it)\b/.test(recent)
}

async function getLatestImageData(token) {
  const rows = await supabaseFetch(
    '/rest/v1/memory_media?select=id,memory_id,storage_path,file_name,mime_type,extracted_text,extracted_data,caption,created_at&media_type=eq.image&order=created_at.desc&limit=1',
    token
  )
  const media = rows?.[0]
  if (!media?.storage_path) return { media: null, dataUrl: null }

  const encodedPath = media.storage_path.split('/').map(encodeURIComponent).join('/')
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/authenticated/memora-media/${encodedPath}`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } }
  )

  if (!response.ok) return { media, dataUrl: null }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > 7 * 1024 * 1024) return { media, dataUrl: null }

  const mime = media.mime_type || response.headers.get('content-type') || 'image/jpeg'
  return { media, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  try {
    const auth = String(req.headers.authorization || '')
    const token = auth.replace(/^Bearer\s+/i, '')
    if (!token) return json(res, 401, { error: 'Missing Memora session' })

    const user = await verifyUser(token)
    if (!user?.id) return json(res, 401, { error: 'Invalid Memora session' })

    const question = trimText(req.body?.question, 2400).trim()
    if (!question) return json(res, 400, { error: 'Question is required' })

    const history = Array.isArray(req.body?.history)
      ? req.body.history.slice(-12).map(item => ({
          role: item?.role === 'assistant' ? 'assistant' : 'user',
          text: trimText(item?.text, 1800),
        }))
      : []

    const [search, recent, people, places, things, documents, profiles] = await Promise.all([
      supabaseFetch('/rest/v1/rpc/search_memory_universe', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ search_query: question, result_limit: 16 }),
      }).catch(() => []),
      supabaseFetch('/rest/v1/memories?select=id,original_text,summary,memory_type,state,occurred_at,created_at,interpreted_data&order=created_at.desc&limit=28', token).catch(() => []),
      supabaseFetch('/rest/v1/people?select=name,relationship,notes,last_seen_at&order=last_seen_at.desc.nullslast&limit=60', token).catch(() => []),
      supabaseFetch('/rest/v1/places?select=name,address,category,notes,last_visited_at&order=last_visited_at.desc.nullslast&limit=40', token).catch(() => []),
      supabaseFetch('/rest/v1/things?select=name,description,current_location,updated_at&order=updated_at.desc&limit=40', token).catch(() => []),
      supabaseFetch('/rest/v1/documents?select=file_name,description,extracted_text,created_at&order=created_at.desc&limit=15', token).catch(() => []),
      supabaseFetch('/rest/v1/profiles?select=display_name,timezone&limit=1', token).catch(() => []),
    ])

    const profile = profiles?.[0] || null

    const evidence = []
    for (const row of compactRows(search, x => x, 16)) {
      evidence.push({
        id: `R${evidence.length + 1}`,
        kind: row.entity_type || 'memory',
        title: trimText(row.title, 220),
        content: trimText(row.content, 2200),
        occurred_at: row.occurred_at || null,
        metadata: row.metadata || {},
      })
    }

    const seenMemory = new Set(evidence.filter(x => x.kind === 'memory').map(x => x.content))
    for (const memory of recent || []) {
      const content = trimText([memory.summary, memory.original_text, memory.interpreted_data ? JSON.stringify(memory.interpreted_data) : ''].filter(Boolean).join(' | '), 2200)
      if (!content || seenMemory.has(content)) continue
      evidence.push({
        id: `M${memory.id}`,
        kind: 'memory',
        title: trimText(memory.summary || memory.memory_type || 'Memory', 220),
        content,
        occurred_at: memory.occurred_at || memory.created_at,
        metadata: { memory_type: memory.memory_type, state: memory.state },
      })
      seenMemory.add(content)
      if (evidence.length >= 28) break
    }

    const peopleFacts = compactRows(people, p => ({
      name: trimText(p.name, 120),
      relationship: trimText(p.relationship, 80),
      notes: trimText(p.notes, 240),
    }), 60)

    const placeFacts = compactRows(places, p => ({
      name: trimText(p.name, 120),
      address: trimText(p.address, 220),
      category: trimText(p.category, 80),
    }), 40)

    const thingFacts = compactRows(things, t => ({
      name: trimText(t.name, 120),
      description: trimText(t.description, 240),
      current_location: trimText(t.current_location, 240),
    }), 40)

    const documentFacts = compactRows(documents, d => ({
      file_name: trimText(d.file_name, 180),
      description: trimText(d.description, 400),
      extracted_text: trimText(d.extracted_text, 1600),
    }), 15)

    let image = { media: null, dataUrl: null }
    if (shouldUseImage(question, history)) {
      image = await getLatestImageData(token).catch(() => ({ media: null, dataUrl: null }))
    }

    const historyText = history
      .filter(x => x.text)
      .map((x, i) => `H${i + 1} ${x.role.toUpperCase()}: ${x.text}`)
      .join('\n')

    const memoryText = evidence
      .map(e => `[${e.id}] ${e.kind.toUpperCase()} | ${e.title} | ${e.occurred_at || 'date unknown'}\n${e.content}`)
      .join('\n\n')

    const structuredText = [
      profile ? `PROFILE: ${JSON.stringify(profile)}` : '',
      peopleFacts.length ? `PEOPLE: ${JSON.stringify(peopleFacts)}` : '',
      placeFacts.length ? `PLACES: ${JSON.stringify(placeFacts)}` : '',
      thingFacts.length ? `THINGS: ${JSON.stringify(thingFacts)}` : '',
      documentFacts.length ? `DOCUMENTS: ${JSON.stringify(documentFacts)}` : '',
      image.media?.extracted_text ? `LATEST_IMAGE_OCR: ${trimText(image.media.extracted_text, 3000)}` : '',
    ].filter(Boolean).join('\n')

    const system = [
      'You are Memora, a private personal memory assistant.',
      'Answer the user naturally, like a highly capable conversational memory assistant.',
      'The user may make spelling mistakes, omit words, use pronouns, or ask a follow-up that depends on earlier turns. Infer the intended wording from context.',
      'Ground personal facts only in the supplied Memora evidence, structured vault facts, conversation history, or attached saved image.',
      'Never invent a personal fact. If the evidence is insufficient, say what is missing in one short sentence.',
      'Prefer direct answers. Do not dump raw memory records unless the user asks for them.',
      'For identity questions such as "Who am I?", synthesize the strongest identity facts from the evidence.',
      'For relationship questions, use the People facts and supporting memories.',
      'For object-location questions, prefer the current location in Things, but respect historical questions such as "where was it before".',
      'For image questions, inspect the attached image directly when present. Use OCR only as supporting evidence, not as the sole source.',
      'If an image contains several numbers, distinguish phone/contact numbers from employee IDs and other identifiers using visible labels and context.',
      'When the user says "it", "that", "this", "there", "more", or "what else", resolve the reference from recent conversation history.',
      'Keep the answer concise but complete. Do not mention internal retrieval mechanics, database tables, prompts, or model names.',
    ].join(' ')

    const userPrompt = [
      `CURRENT QUESTION: ${question}`,
      historyText ? `RECENT CONVERSATION:\n${historyText}` : '',
      memoryText ? `RELEVANT AND RECENT MEMORIES:\n${memoryText}` : 'RELEVANT AND RECENT MEMORIES: none',
      structuredText ? `STRUCTURED MEMORY VAULT:\n${structuredText}` : '',
      image.media ? `LATEST SAVED IMAGE: ${image.media.file_name || 'saved image'} from ${image.media.created_at || 'unknown date'}` : '',
      'Answer the current question using the evidence above.',
    ].filter(Boolean).join('\n\n')

    const gatewayToken = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN
    if (!gatewayToken) return json(res, 503, { error: 'AI reasoning is not available in this deployment' })

    const userContent = [{ type: 'input_text', text: userPrompt }]
    if (image.dataUrl) userContent.push({ type: 'input_image', image_url: image.dataUrl, detail: 'high' })

    const aiResponse = await fetch('https://ai-gateway.vercel.sh/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-5.6-luna',
        input: [
          { type: 'message', role: 'system', content: system },
          { type: 'message', role: 'user', content: userContent },
        ],
        max_output_tokens: 700,
        reasoning: { effort: 'low' },
        store: false,
        providerOptions: {
          gateway: {
            models: [
              'openai/gpt-5.6-luna',
              'google/gemini-3.6-flash',
              'anthropic/claude-sonnet-4.6'
            ]
          }
        }
      }),
    })

    const result = await aiResponse.json().catch(() => ({}))
    if (!aiResponse.ok) {
      const message = result?.error?.message || `AI Gateway request failed (${aiResponse.status})`
      return json(res, 502, { error: message })
    }

    const answer = extractGatewayText(result)
    if (!answer) return json(res, 502, { error: 'The reasoning model returned an empty answer' })

    const source = image.media
      ? 'Memora AI grounded in your saved memories and latest saved image'
      : 'Memora AI grounded in your saved memories'

    return json(res, 200, {
      answer,
      source,
      ai: true,
      imageUsed: Boolean(image.dataUrl),
      imageName: image.media?.file_name || null,
    })
  } catch (error) {
    return json(res, 500, { error: error?.message || 'Unexpected Memora reasoning error' })
  }
}
