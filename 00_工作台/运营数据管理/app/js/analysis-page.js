(async()=>{
  const status=document.getElementById('analysis-access');
  try{
    Auth.init();window.opener=null;
    if(!Auth.isLoggedIn||Auth.currentUser?.needPasswordChange){status.textContent='请先在主系统登录并完成账号验证，再从运营管理打开分析页。';return;}
    await Auth.loadOperationsRollout();if(!Auth.canAccessOperations()){status.textContent='当前账号没有经营分析访问权限。';return;}
    const params=new URLSearchParams(location.search),view=['funnel','linkage','products'].includes(params.get('view'))?params.get('view'):'funnel';
    document.querySelectorAll('.analysis-header nav a').forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='?view='+view));
    status.hidden=true;
    if(view==='funnel')await VisitorAnalysis.init();
    else{document.getElementById('analysis-other').hidden=false;document.getElementById('analysis-title').textContent=view==='linkage'?'票种与跨业务联动':'单品销量与选品';OperationsBusinessAnalysis._view=view;await OperationsItemAnalysis.init();}
  }catch(error){status.hidden=false;status.textContent='分析页面暂不可用：'+error.message;}
})();
