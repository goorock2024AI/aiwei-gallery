'use strict';
const fs=require('node:fs'),path=require('node:path'),{hash}=require('./daily-brief-core');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const value=v=>v==null?'未取得':String(v);
const localTime=v=>v&&!Number.isNaN(Date.parse(v))?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+'（北京时间）':String(v||'未取得');
const stockStatus=v=>({urgent:'紧急补货',warning:'注意补货',normal:'正常',setup:'待初始化',ok:'正常'}[v]||'请查看库存模块');
const template=require('./daily-brief-template');
const blocks=template.sections;
function html(p){return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.date)} 艾维经营日报</title><style>body{margin:0;background:#f5f3eb;color:#253e33;font:17px/1.85 system-ui,'Microsoft YaHei',sans-serif}main{max-width:760px;margin:auto;padding:28px}small{color:#69746c}h1{font-size:30px}h2{font-size:21px;color:#896834}section{background:white;padding:20px;margin:18px 0}p{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:420px){main{padding:16px}h1{font-size:26px}}@media print{body{background:white}section{break-inside:avoid}}</style><main><small>艾维美术馆 · 今日复盘 / 明日提示</small><h1>${esc(p.date)} 经营日报${p.preview?" · 样稿":""}</h1><small>${esc(template.note(p))}</small>${blocks(p).map(([title,body])=>`<section><h2>${esc(title)}</h2><p>${esc(body)}</p></section>`).join('')}<small>天气来源：<a href="https://developer.qweather.com/attribution.html">和风天气</a></small></main></html>`;}
function svg(p){let y=62;const nodes=[];const text=(s,size=30,color='#253e33')=>{for(const paragraph of String(s).split('\n')){let line='';let units=0;for(const ch of paragraph){const n=ch.charCodeAt(0)<256?.55:1;if(units+n>Math.floor(716/size)&&!/[，。；、！？％%）]/.test(ch)){nodes.push(`<text x="42" y="${y}" font-size="${size}" fill="${color}">${esc(line)}</text>`);y+=size*1.65;line='';units=0;}line+=ch;units+=n;}nodes.push(`<text x="42" y="${y}" font-size="${size}" fill="${color}">${esc(line)}</text>`);y+=size*1.65;}};
 text('艾维美术馆 / 经营日报'+(p.preview?' · 样稿，未发布':''),21,'#896834');text(p.date+'　'+(p.finalized?'已日结':'暂报'),34);text('今日复盘 · 明日提示',21);y+=20;
 for(const [title,body]of blocks(p)){text(title,28,'#896834');text(body);y+=25;}
 if(template.note(p))text(template.note(p),20,'#69746c');text('天气来源：和风天气',18,'#69746c');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${Math.ceil(y+35)}"><rect width="100%" height="100%" fill="#f5f3eb"/><g font-family="Noto Sans SC" font-weight="400">${nodes.join('')}</g></svg>`;
}
function renderFiles(p,directory){const {Resvg}=require('@resvg/resvg-js');const font=path.join(__dirname,'fonts/NotoSansSC-Regular.ttf');if(!fs.existsSync(font))throw Error('缺少日报中文字体');const vector=svg(p);const png=Buffer.from(new Resvg(vector,{font:{fontFiles:[font],loadSystemFonts:false,defaultFontFamily:'Noto Sans SC'}}).render().asPng());
 if(png.length>2*1024*1024)throw Error('长图超过群图片发送限制，需拆图');
 const files={html:Buffer.from(html(p)),png};const artifacts={};fs.mkdirSync(directory,{recursive:true,mode:0o700});
 for(const [ext,bytes]of Object.entries(files)){const file=p.id+'.'+ext;fs.writeFileSync(path.join(directory,file),bytes,{flag:'wx',mode:0o600});artifacts[ext]={file,sha256:hash(bytes),bytes:bytes.length};}return artifacts;}
module.exports={blocks,html,svg,renderFiles};
