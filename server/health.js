export default async function handler(req,res,env={}) {
async function run(req,res){
  if(!['GET','HEAD'].includes(req.method)) {res.statusCode=405;return res.end(JSON.stringify({error:'Method not allowed'}))}
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.setHeader('Cache-Control','no-store')
  res.statusCode=200
  res.end(JSON.stringify({
    ok:true,
    version:'43.1',
    routes:['ask','audio-library','open-music','scene-background','health'],
    aiGateway:Boolean(env.AI_GATEWAY_API_KEY),
    runtime:'cloudflare-pages',
    timestamp:new Date().toISOString()
  }))
}
return run(req,res)
}
handler.allow='GET, HEAD'
