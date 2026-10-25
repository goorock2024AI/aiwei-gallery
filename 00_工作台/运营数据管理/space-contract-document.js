'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),PDFDocument=require('pdfkit');
const template=require('./templates/space-contract-v1.json');
const schema=require('./app/js/space-project-schema');
const esc=s=>String(s??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
function amountCN(value){
 if(!Number.isFinite(Number(value)))return '【待补充】';let n=Math.round(Number(value)*100);if(n===0)return '零元整';
 const digits='零壹贰叁肆伍陆柒捌玖',units=['','拾','佰','仟'];
 const small=n=>{let s='',zero=false;for(let i=3;i>=0;i--){const d=Math.floor(n/10**i)%10;if(d){if(zero)s+='零';s+=digits[d]+units[i];zero=false;}else if(s)zero=true;}return s;};
 let yuan=Math.floor(n/100),str='';const groups=[];while(yuan){groups.push(yuan%10000);yuan=Math.floor(yuan/10000);}for(let i=groups.length-1;i>=0;i--){if(!groups[i]){if(str&&!str.endsWith('零'))str+='零';continue;}if(i<groups.length-1&&groups[i]<1000&&str&&!str.endsWith('零'))str+='零';str+=small(groups[i])+['','万','亿'][i];}
 str=str.replace(/零$/,'')||'零';str+='元';const j=Math.floor(n/10)%10,f=n%10;return str+(j?digits[j]+'角':f?'零':'')+(f?digits[f]+'分':!j?'整':'');
}
function model(snapshot){
 const f=snapshot.terms||{},v=k=>String(f[k]??'').trim()||'【待补充】';
 const payments=snapshot.payments||[],points=snapshot.publicity||[];
 const required=['partyAName','partyBName','projectName','venueName','spaceName','exhibitStart','exhibitEnd','setupStart','setupEnd','strikeStart','strikeEnd','totalAmount','taxBasis','services','setupScope','paymentBeforeEntry','accountText','depositApplicable','invoiceTerms'];
 const missing=required.filter(k=>!String(f[k]??'').trim()||f[k]==='待商议').map(k=>schema.fields.find(a=>a[0]===k)?.[1]||k);
 if(!payments.length)missing.push('付款节点');if(payments.some(p=>!p.dueDate&&!p.trigger))missing.push('各期付款日期或触发条件');
 if(f.totalAmount&&payments.length&&Math.round(payments.reduce((a,p)=>a+Number(p.amount||0),0)*100)!==Math.round(Number(f.totalAmount)*100))missing.push('付款合计与总价一致');
 if(f.depositApplicable==='收取'&&(!f.depositAmount||!f.depositDue))missing.push('保证金金额及付款时间');
 if(points.some(p=>!p.point||!p.width||!p.height||!p.unit))missing.push('宣传点位及尺寸');
 const payText=payments.length?payments.map((p,i)=>`${i+1}、${p.dueDate||p.trigger||'【到期条件待补充】'}支付人民币${Number(p.amount||0).toFixed(2)}元${p.notes?'，'+p.notes:''}`).join('；'):'【付款节点、金额及期限待补充】';
 const override={
  0:'美术馆展览场地租赁及使用协议',1:'合同草稿 供商务洽谈核对',
  2:`合同编号：${v('contractNo')}    签订地点：${v('signPlace')}`,
  3:`甲方（场地出租方）：${v('partyAName')}\n统一社会信用代码：${v('partyACode')}\n地址：${v('partyAAddress')}\n联系人及电话：${v('partyAContact')}\n电子邮箱：${v('partyAEmail')}`,
  4:`乙方（展览主办／承租方）：${v('partyBName')}\n统一社会信用代码／身份证号码：${v('partyBCode')}\n地址：${v('partyBAddress')}\n联系人及电话：${v('partyBContact')}\n电子邮箱：${v('partyBEmail')}`,
  7:`1.1 场地名称：${v('venueName')}；详细地址：${v('venueAddress')}；租用区域：${v('spaceName')}；约定使用面积约${v('area')}平方米。场地使用范围及配套设施：${v('scope')}。`,
  8:`1.2 约定用途：举办${v('projectName')}艺术展览及经甲方书面认可的配套活动。未经甲方书面同意，乙方不得转租、转借、变更用途或举办与约定展览无关的商业活动。`,
  11:`2.1 场地使用总期间以双方确认的布展、展览及撤展安排为准。布展期：${v('setupStart')}至${v('setupEnd')}；展览对公众开放期：${v('exhibitStart')}至${v('exhibitEnd')}；撤展期：${v('strikeStart')}至${v('strikeEnd')}。具体开放时段：${v('openHours')}。`,
  12:`2.2 提前进场、延时闭馆及超时撤展须事先书面批准，具体安排与计费：${v('lateFeeTerms')}。乙方不得擅自留置作品、物料或人员。`,
  13:'2.3 场地交付及退场状态由双方现场核对确认；退场时共同验收并留存照片或视频。',
  14:'第三条  费用、保证金及结算',
  15:`3.1 本项目场地租赁及约定服务总价为人民币${v('totalAmount')}元（大写：${amountCN(f.totalAmount)}；${v('taxBasis')}）。包含服务：${v('services')}。费用及服务明细见附件一。`,
  16:`3.2 付款安排：${payText}。进场或布展前的付款要求：${v('paymentBeforeEntry')}。甲方指定收款账户：${v('accountText')}。`,
  17:f.depositApplicable==='不收取'?'3.3 本项目不收取场地履约保证金。':`3.3 场地履约保证金安排：${f.depositApplicable==='收取'?'人民币'+v('depositAmount')+'元，于'+v('depositDue')+'支付':'【是否收取、金额及付款条件待商议】'}。该款项系履约保证金，不当然等同于定金；不适用定金罚则，除非另有符合法律规定的明确书面约定。`,
  18:f.depositApplicable==='不收取'?'3.4 本项目无保证金退还事项。损坏修复、超时使用及其他应付费用，依实际发生及双方约定核对处理。':template.blocks.find(b=>b.kind==='p'&&b.index===18).text.replace('【    】',v('depositReturnDays')),
  19:`3.5 额外服务须由双方事先确认收费标准。约定：${v('extraServices')}。发票类型、税费及开票时间：${v('invoiceTerms')}。`,
  22:`4.2 乙方须在进场前${v('submissionDays')}日提交展览策划案、作品清单及尺寸重量、平面布展图、施工方案、用电负荷、活动计划、人员及供应商名单、应急预案与保险凭证（如适用）。甲方应于收到完整材料后${v('reviewDays')}个工作日内反馈审查意见。`,
  28:template.blocks.find(b=>b.kind==='p'&&b.index===28).text+' 本项目布展协助范围及分工：'+v('setupScope')+'。',
  30:`6.1 作品交接、包装、运输、装卸、安装、撤展及返还分工：${v('workResponsibilities')}。具体交接节点、保管人、范围及作品状态在附件三明确。单纯提供展厅和一般安保，不当然视为甲方接受作品专项保管。`,
  32:`6.3 作品保险适用情况、投保方、险种、期间、保额、免赔额与凭证要求：${v('insuranceTerms')}。未购买保险不当然免除依法应承担的赔偿责任。`,
  36:`7.2 观众限流人数：${v('capacity')}人（以依法核定的场所容量和主管要求为上限）；开幕活动预计人数：${v('openingVisitors')}人。票务、签到、秩序维护及应急分工：${v('safetyResponsibilities')}。`,
  39:`8.1 甲方提供：${v('services')}。具体范围及额外服务以附件一为准。甲方应保障约定场地在约定时段具备适用条件，非紧急情况不得任意中断乙方正常使用。`,
  40:`8.2 门票及衍生活动收入、费用与退款安排：${v('ticketTerms')}。作品销售安排：${v('salesTerms')}。`,
  45:`9.3 展览现场摄影、摄像、直播、媒体采访及影像使用安排：${v('imageTerms')}。宣传点位、物料设计尺寸及本项目使用约定见附件四；设计、审核、制作、安装、费用及撤除分工：${v('publicityResponsibilities')}。`,
  48:`10.2 乙方取消、改期的约定条件及费用：${v('cancellationTerms')}。违约金过分高于实际损失的，依法可请求调整。甲方应提供合理费用依据并避免重复获偿。`,
  49:template.blocks.find(b=>b.kind==='p'&&b.index===49).text.replace('【    】',v('landlordBreachTerms')),
  53:`11.1 双方以上述地址、邮箱作为送达联系方式，变更须提前书面告知。通知确认规则：${v('notificationTerms')}。`,
  54:'11.2 本协议适用中华人民共和国法律（为本合同目的，不含港澳台地区法律）。争议解决的明确约定：'+v('disputeTerms')+'。',
  56:'11.4 合同一式'+v('contractCopies')+'份，双方各执'+v('copiesEach')+'份。其他补充约定：'+v('additionalTerms')+'。',
  62:'附件一  费用及服务明细',63:'总价包含服务：'+v('services')+'；布展协助：'+v('setupScope')+'。',
  64:'附件二  展览计划与责任分工',65:'附件三  作品清单与状态记录',
  66:'作品交接、运输、安装、撤展及保管分工：'+v('workResponsibilities')+'。',
  68:'□ 核对双方主体及使用权限；□ 核对布展、展期和撤展时间；□ 核对总价、付款、保证金和税费；□ 核对服务与宣传物料；□ 核对作品及现场责任；□ 核对取消变更和全部附件；□ 双方确认版本后签署。'
 };
 const tables={
  2:[['费用或服务','本项目约定'],['项目总价',v('totalAmount')+'元，'+v('taxBasis')],['包含服务',v('services')],['布展协助',v('setupScope')],['额外服务',v('extraServices')],['付款安排',payText],['保证金',v('depositApplicable')+(f.depositApplicable==='收取'?'，'+v('depositAmount')+'元':'')]],
  3:[['事项','内容／分工'],['项目及场地',v('projectName')+'，'+v('spaceName')],['布展',v('setupStart')+'至'+v('setupEnd')],['展期',v('exhibitStart')+'至'+v('exhibitEnd')],['撤展',v('strikeStart')+'至'+v('strikeEnd')],['布展协助',v('setupScope')],['作品责任',v('workResponsibilities')],['现场与观众',v('safetyResponsibilities')]],
  4:[['序号','作品名称／作者','媒介／尺寸','状态及照片','保险信息'],['1','【待提供作品清单】','【待补充】','【待补充】','【待补充】']]
 };
 const blocks=template.blocks.filter(b=>!(b.kind==='p'&&[59,60,61,67,68,69].includes(b.index))&&!(b.kind==='table'&&b.index===1)).map(b=>b.kind==='p'?{...b,text:override[b.index]??b.text}:{...b,rows:tables[b.index]||b.rows});
 blocks.splice(2,0,{kind:'p',text:'本文件为待协商草稿，不代表双方已签署。待核对：'+(missing.join('、')||'请核对全部商务条件及附件')+'。'});
 blocks.push({kind:'p',text:'附件四  宣传点位与物料设计尺寸'});
 blocks.push({kind:'table',rows:[['点位／位置','物料／数量','设计宽×高／单位／方向','展示时间','设计制作及安装分工'],...(points.length?points.map(p=>[p.point,[p.material,p.quantity].filter(Boolean).join('／'),`${p.width||'待核'}×${p.height||'待核'} ${p.unit||'单位待核'} ${p.orientation||''}${p.specification?'；'+p.specification:''}`,p.period||'待商议',p.responsibilities||v('publicityResponsibilities')]):[['【待提供点位】','【待补充】','【尺寸待核实】','【待商议】',v('publicityResponsibilities')]])]});
 blocks.push({kind:'p',text:'签署前核对清单'},{kind:'p',text:override[68]});
 return {blocks,missing:[...new Set(missing)]};
}
function paragraph(b){const pr=b.xml?.match(/<w:pPr[\s\S]*?<\/w:pPr>/)?.[0]||'';const rp=b.xml?.match(/<w:rPr[\s\S]*?<\/w:rPr>/)?.[0]||'<w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="宋体"/><w:sz w:val="22"/></w:rPr>';return '<w:p>'+pr+'<w:r>'+rp+String(b.text||'').split('\n').map(t=>'<w:t xml:space="preserve">'+esc(t)+'</w:t>').join('<w:br/>')+'</w:r></w:p>';}
function tableXML(rows){const widths=rows[0].map(()=>Math.floor(9000/rows[0].length));return '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(k=>`<w:${k} w:val="single" w:sz="4" w:color="D9D9D9"/>`).join('')+'</w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>'+widths.map(w=>`<w:gridCol w:w="${w}"/>`).join('')+'</w:tblGrid>'+rows.map((row,i)=>'<w:tr>'+(i===0?'<w:trPr><w:tblHeader/></w:trPr>':'')+row.map((c,j)=>`<w:tc><w:tcPr><w:tcW w:w="${widths[j]}" w:type="dxa"/>${i===0?'<w:shd w:fill="EEEEEE"/>':''}</w:tcPr>${paragraph({text:c})}</w:tc>`).join('')+'</w:tr>').join('')+'</w:tbl>';}
const crcTable=Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
function zip(parts){let offset=0;const files=[],central=[];for(const [name,data]of Object.entries(parts)){const raw=Buffer.isBuffer(data)?data:Buffer.from(data),packed=zlib.deflateRawSync(raw),nb=Buffer.from(name);let c=0xffffffff;for(const b of raw)c=crcTable[(c^b)&255]^(c>>>8);c=(c^0xffffffff)>>>0;const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt32LE(c,14);h.writeUInt32LE(packed.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(nb.length,26);files.push(h,nb,packed);const cd=Buffer.alloc(46);cd.writeUInt32LE(0x02014b50,0);cd.writeUInt16LE(20,4);cd.writeUInt16LE(20,6);cd.writeUInt16LE(0x800,8);cd.writeUInt16LE(8,10);cd.writeUInt32LE(c,16);cd.writeUInt32LE(packed.length,20);cd.writeUInt32LE(raw.length,24);cd.writeUInt16LE(nb.length,28);cd.writeUInt32LE(offset,42);central.push(cd,nb);offset+=h.length+nb.length+packed.length;}const cs=Buffer.concat(central),e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50,0);e.writeUInt16LE(Object.keys(parts).length,8);e.writeUInt16LE(Object.keys(parts).length,10);e.writeUInt32LE(cs.length,12);e.writeUInt32LE(offset,16);return Buffer.concat([...files,cs,e]);}
function docx(snapshot){const {blocks}=model(snapshot),parts=Object.fromEntries(Object.entries(template.parts).map(([k,v])=>[k,Buffer.from(v,'base64')]));parts['word/document.xml']=template.root+blocks.map(b=>b.kind==='table'?tableXML(b.rows):paragraph(b)).join('')+template.section+'</w:body></w:document>';return zip(parts);}
async function pdf(snapshot){const {blocks}=model(snapshot),font=path.join(__dirname,'fonts/NotoSansSC-Regular.ttf');if(!fs.existsSync(font))throw Error('合同字体资源缺失');return new Promise((resolve,reject)=>{const d=new PDFDocument({size:'A4',margins:{top:48,bottom:48,left:52,right:52},bufferPages:true,info:{CreationDate:new Date(snapshot._documentCreatedAt||'2026-10-25T00:00:00Z'),ModDate:new Date(snapshot._documentCreatedAt||'2026-10-25T00:00:00Z')}}),chunks=[];d.on('data',b=>chunks.push(b));d.on('error',reject);d.on('end',()=>resolve(Buffer.concat(chunks)));d.registerFont('Chinese',font).font('Chinese').fillColor('black');for(const b of blocks){if(b.kind==='p'){const heading=/^第[一二三四五六七八九十]+条|^附件|^签署前/.test(b.text);d.fontSize(b.index===0?17:heading?12:10.5);const height=d.heightOfString(b.text,{width:491,lineGap:4})+12;if(d.y+Math.max(height,heading?100:0)>d.page.height-48&&height<650)d.addPage();d.text(b.text,{lineGap:4,paragraphGap:5,align:b.index===0?'center':'left'}).moveDown(0.35);}else{for(const row of b.rows){d.fontSize(9.5);const text=row.join('  ｜  '),height=d.heightOfString(text,{width:491,lineGap:3})+6;if(d.y+height>d.page.height-48&&height<650)d.addPage();d.text(text,{lineGap:3,paragraphGap:3});}d.moveDown(0.6);}}d.end();});}
module.exports={model,docx,pdf,amountCN};
