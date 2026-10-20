// No external image dependency: renders Memora's distinctive petal emblem
// as standard lossless RGBA PNGs for Apple Home Screen and Android PWA icons.
import { deflateSync } from 'node:zlib'
import { writeFile } from 'node:fs/promises'
const pngSignature=Buffer.from('89504e470d0a1a0a','hex')
function crc32(data){
 let crc=-1
 for(const byte of data){
  crc^=byte
  for(let k=0;k<8;k++) crc=(crc>>>1)^((crc&1)?0xedb88320:0)
 }
 return (crc^(-1))>>>0
}
function chunk(type,data){
 const t=Buffer.from(type,'ascii')
 const head=Buffer.alloc(4);head.writeUInt32BE(data.length,0)
 const sum=Buffer.alloc(4);sum.writeUInt32BE(crc32(Buffer.concat([t,data])),0)
 return Buffer.concat([head,t,data,sum])
}
const petals=[
 {x:64,y:42,rx:13,ry:30,rotation:0,color:[248,182,94]},
 {x:46,y:61,rx:12,ry:28,rotation:-0.56,color:[244,90,145]},
 {x:82,y:61,rx:12,ry:28,rotation:0.56,color:[77,220,179]},
 {x:36,y:75,rx:15,ry:25,rotation:-1.03,color:[226,72,161]},
 {x:92,y:75,rx:15,ry:25,rotation:1.03,color:[75,170,237]},
 {x:49,y:92,rx:12,ry:22,rotation:-1.14,color:[241,130,125]},
 {x:79,y:92,rx:12,ry:22,rotation:1.14,color:[65,196,228]}
]
function pixel(x,y){
 // Coordinates use a 128-unit vector reference so large and small icon
 // sizes produce the same brand silhouette.
 let rgb=[11+Math.round(x*.08),17+Math.round(y*.04),29+Math.round(x*.09)]
 for(const p of petals){
   const dx=x-p.x,dy=y-p.y
   const u=dx*Math.cos(p.rotation)+dy*Math.sin(p.rotation)
   const v=-dx*Math.sin(p.rotation)+dy*Math.cos(p.rotation)
   const k=(u/p.rx)**2+(v/p.ry)**2
   if(k<=1){
     const strength=Math.min(.96,.83+.12*(1-k))
     rgb=rgb.map((n,i)=>Math.round(n*(1-strength)+(p.color[i]+(1-k)*12)*strength))
   }
 }
 const d=((x-64)**2+(y-89)**2)**.5
 if(d<5.2)rgb=[250,251,252]
 return [...rgb,255]
}
async function drawPng(size,out){
 const stride=1+size*4
 const raw=Buffer.alloc(size*stride)
 for(let y=0;y<size;y++){
  const offset=y*stride
  raw[offset]=0
  for(let x=0;x<size;x++){
   const rgba=pixel(128*(x+.5)/size,128*(y+.5)/size)
   const at=offset+1+x*4
   for(let channel=0;channel<4;channel++)raw[at+channel]=rgba[channel]
  }
 }
 const ihdr=Buffer.alloc(13)
 ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4)
 ihdr[8]=8;ihdr[9]=6
 const png=Buffer.concat([pngSignature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))])
 await writeFile(out,png)
}
await Promise.all([[180,'dist/apple-touch-icon.png'],[192,'dist/icon-192.png'],[512,'dist/icon-512.png']].map(([size,path])=>drawPng(size,path)))
