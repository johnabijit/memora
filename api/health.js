module.exports = async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.setHeader('Cache-Control','no-store')
  res.statusCode=200
  res.end(JSON.stringify({
    ok:true,
    aiGateway:Boolean(process.env.AI_GATEWAY_API_KEY||process.env.VERCEL_OIDC_TOKEN),
    runtime:'vercel',
    timestamp:new Date().toISOString()
  }))
}
