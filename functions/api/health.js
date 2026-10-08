// Cloudflare Pages adapter for the existing Memora Vercel API logic.
let env={};
function makeResponse(){let statusCode=200;const headers=new Headers();let body='';return {get statusCode(){return statusCode},set statusCode(v){statusCode=v},setHeader(k,v){headers.set(k,String(v))},status(v){statusCode=v;return this},end(v=''){body=v;return this},toResponse(){return new Response(body,{status:statusCode,headers})}}}
async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.setHeader('Cache-Control','no-store')
  res.statusCode=200
  res.end(JSON.stringify({
    ok:true,
    aiGateway:Boolean(env.AI_GATEWAY_API_KEY||env.VERCEL_OIDC_TOKEN),
    runtime:'cloudflare',
    timestamp:new Date().toISOString()
  }))
}

export async function onRequest({request,env:bindings}){
 env=bindings||{};
 const url=new URL(request.url);
 const query=Object.fromEntries(url.searchParams);
 const req={method:request.method,query,headers:Object.fromEntries(request.headers)};
 const res=makeResponse();
 try { await handler(req,res); return res.toResponse(); }
 catch(error){return Response.json({error:'Service temporarily unavailable'},{status:502,headers:{'Cache-Control':'no-store'}})}
}
