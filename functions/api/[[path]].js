export function onRequest() {
  return Response.json({ error: 'API route not found' }, {
    status: 404, headers: { 'Cache-Control': 'no-store' }
  })
}
