# Grounded memory retrieval — first implementation (experimental)

This branch makes the **existing** AI endpoint use query-focused retrieved memory rather than dumping a maximum of 26 memories into its prompt, and returns a **source catalog** next to each answer. It is a first-stage retrieval enhancement, **not a fully verified or complete vector-RAG system**.

## Design principles
- Only fetch rows under the signed-in user's JWT and Supabase RLS. Never share other users' memories with an AI provider.
- Treat memories, document text, OCR and source text as data, not executable instructions.
- Answers about personal information should cite an existing evidence ID. A model's citation is NOT proof a claim is true. UI may expose the source memory on click and permit correction.
- Do not expose API credentials or private media to external providers without explicit user permission.
- Never auto-create reminders, update facts, send messages or change records solely from generated prose.
- Never pretend that an AI request was completed if the provider was unavailable.
- Avoid promising unlimited free AI model inference: local search is always free, inference is subject to funding/quota.

## Next production milestones (not implemented in this PR)
1. Proper hybrid retrieval: multilingual full-text with `tsvector`, embeddings using pgvector, RRF, and user-scoped RLS for every chunk. See https://supabase.com/docs/guides/ai/hybrid-search.
2. Chunk documents/transcripts with offsets, title, timestamp, source and retention metadata; implement deletion propagation for chunks and embeddings.
3. Add evidence verification step, confidence/abstention decisions and conflict detection between different versions of facts. Test these against real user fixtures.
4. Durable reminders with timezone, idempotency, scheduled delivery receipts, retries and dead-letter alerts.
5. Local-first offline capture and opt-in sync; voice transcription support for multiple languages/accents.
6. Harden AI provider selection, user quotas, cost controls, privacy disclosure, and model quality regressions.
7. Brand migration only after naming/trademark screening and explicit selection.

## Development
Run `node --test tests/grounding.test.js` in a checkout with Node.js 18+.
The added library is dependency-free and never calls an AI service directly.
Review privacy/security and benchmark retrieval before merging this branch.
