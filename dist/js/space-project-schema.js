'use strict';
(function(root){
 const groups=[
 ['主体与项目',[
 ['partyAName','甲方签约主体'],['partyACode','甲方统一社会信用代码'],['partyAAddress','甲方地址'],['partyAContact','甲方联系人及电话'],['partyAEmail','甲方邮箱'],
 ['partyBName','乙方签约主体'],['partyBCode','乙方统一社会信用代码或身份证号'],['partyBAddress','乙方地址'],['partyBContact','乙方联系人及电话'],['partyBEmail','乙方邮箱'],
 ['contractNo','拟用合同编号'],['signPlace','签订地点'],['projectName','展览名称'],['venueName','场馆名称'],['venueAddress','场地详细地址'],['spaceName','使用区域'],['area','约定使用面积（平方米）'],['scope','场地及配套设施范围','text']]],
 ['展期与使用时间',[
 ['exhibitStart','展期开始','date'],['exhibitEnd','展期结束','date'],['setupStart','布展开始','date'],['setupEnd','布展结束','date'],['strikeStart','撤展开始','date'],['strikeEnd','撤展结束','date'],['openHours','每日开放时段'],['lateFeeTerms','提前进场、延时与超时使用约定','text']]],
 ['价格与付款',[
 ['totalAmount','商定总价（元）','money'],['taxBasis','含税口径','select',['待商议','含税','不含税']],['services','总价包含的服务','text'],['setupScope','布展协助范围与双方分工','text'],['extraServices','额外服务及费用确认方式','text'],['paymentBeforeEntry','进场或布展前的付款要求','text'],['accountText','收款账户信息','text'],['depositApplicable','是否收取履约保证金','select',['待商议','不收取','收取']],['depositAmount','履约保证金（元）','money'],['depositDue','保证金付款时间或条件'],['depositReturnDays','验收及核算后退还保证金的工作日数'],['invoiceTerms','开票类型、税费与开票时间','text']]],
 ['执行与商务分工',[
 ['submissionDays','进场前提交资料的提前天数'],['reviewDays','完整资料收到后的反馈工作日数'],['workResponsibilities','作品交接、运输、安装、撤展及保管分工','text'],['insuranceTerms','保险适用情况、负责方及约定','text'],['capacity','核实后的观众限流人数'],['openingVisitors','开幕预计人数'],['safetyResponsibilities','现场、观众及应急分工','text'],['ticketTerms','票务及衍生活动收入、费用和退款安排','text'],['salesTerms','作品销售是否允许及另行约定'],['imageTerms','拍摄、影像及宣传授权约定','text'],['publicityResponsibilities','宣传设计、审核、制作、安装、费用与撤除分工','text']]],
 ['变更与补充条件',[
 ['cancellationTerms','取消、改期的馆方拟议或双方商定条件','text'],['landlordBreachTerms','馆方无法交付或取消的约定责任','text'],['disputeTerms','争议解决条款的明确选择与内容','text'],['notificationTerms','通知及送达确认方式','text'],['contractCopies','合同总份数'],['copiesEach','双方各执份数'],['additionalTerms','其他补充约定','text']]]
 ];
 const stages=['线索','洽谈','待签署','暂缓','未成交'];
 const isOpportunity=p=>stages.concat('待确认').includes(p.businessStatus||p.business_status||'');
 const schema={groups,stages,isOpportunity,version:'space-contract-20261025-v1',fields:groups.flatMap(g=>g[1])};
 if(typeof module!=='undefined'&&module.exports)module.exports=schema;else root.SpaceProjectSchema=schema;
})(typeof window!=='undefined'?window:globalThis);
