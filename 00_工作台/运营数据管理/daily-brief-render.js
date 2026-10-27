'use strict';
const fs=require('node:fs'),path=require('node:path'),{hash}=require('./daily-brief-core');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const template=require('./daily-brief-template');
const blocks=template.sections;
function html(p){return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.date)} 艾维经营日报</title><style>body{margin:0;background:#f5f3eb;color:#253e33;font:17px/1.85 system-ui,'Microsoft YaHei',sans-serif}main{max-width:760px;margin:auto;padding:28px}small{color:#69746c}h1{font-size:30px}h2{font-size:21px;color:#896834}section{background:white;padding:20px;margin:18px 0}p{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:420px){main{padding:16px}h1{font-size:26px}}@media print{body{background:white}section{break-inside:avoid}}</style><main><h1>${esc(template.title(p))}${p.preview?" · 样稿":""}</h1>${template.isClosed(p)?'':'<p>'+esc(template.dateLine(p))+'</p>'}${blocks(p).map(([title,body])=>`<section><h2>${esc(title)}</h2><p>${esc(body)}</p></section>`).join('')}</main></html>`;}
function svg(p){let y=62;const nodes=[];const text=(s,size=30,color='#253e33')=>{for(const paragraph of String(s).split('\n')){let line='';let units=0;for(const ch of paragraph){const n=ch.charCodeAt(0)<256?.55:1;if(units+n>Math.floor(716/size)&&!/[，。；、！？％%）]/.test(ch)){nodes.push(`<text x="42" y="${y}" font-size="${size}" fill="${color}">${esc(line)}</text>`);y+=size*1.65;line='';units=0;}line+=ch;units+=n;}nodes.push(`<text x="42" y="${y}" font-size="${size}" fill="${color}">${esc(line)}</text>`);y+=size*1.65;}};
 text(template.title(p)+(p.preview?' · 样稿，未发布':''),30,'#896834');
 if(!template.isClosed(p))text(template.dateLine(p),23);y+=20;
 for(const [title,body]of blocks(p)){text(title,28,'#896834');text(body,title==='统计说明'?20:30);y+=25;}
 return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${Math.ceil(y+35)}"><rect width="100%" height="100%" fill="#f5f3eb"/><g font-family="Noto Sans SC" font-weight="400">${nodes.join('')}</g></svg>`;
}
function renderFiles(p,directory){const {Resvg}=require('@resvg/resvg-js');const font=path.join(__dirname,'fonts/NotoSansSC-Regular.ttf');if(!fs.existsSync(font))throw Error('缺少日报中文字体');const vector=svg(p);const png=Buffer.from(new Resvg(vector,{font:{fontFiles:[font],loadSystemFonts:false,defaultFontFamily:'Noto Sans SC'}}).render().asPng());
 if(png.length>2*1024*1024)throw Error('长图超过群图片发送限制，需拆图');
 const files={html:Buffer.from(html(p)),png};const artifacts={};fs.mkdirSync(directory,{recursive:true,mode:0o700});
 for(const [ext,bytes]of Object.entries(files)){const file=p.id+'.'+ext;fs.writeFileSync(path.join(directory,file),bytes,{flag:'wx',mode:0o600});artifacts[ext]={file,sha256:hash(bytes),bytes:bytes.length};}return artifacts;}
module.exports={blocks,html,svg,renderFiles};
