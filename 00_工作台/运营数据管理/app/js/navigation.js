'use strict';
// Navigation owns location; each existing module continues to own its data and permissions.
const AppNavigation={
 current:null,epoch:0,last:{},
 groups:[['sales','收银台'],['space','空间使用'],['gallery','画廊业务'],['stock','库存与采购'],['finance','经营与财务'],['settings','系统设置']],
 routes:[
  {id:'revenue',group:'sales',label:'销售与订单',module:'revenue',render:()=>UI.renderRevenuePage()},
  {id:'space',group:'space',label:'合作与使用',module:'space',render:()=>UI.renderSpacePage()},
  {id:'project-list',group:'space',label:'收款与待收',module:'project-list',render:()=>UI.renderProjectListPage()},
  {id:'space-calendar',group:'space',label:'日历安排',module:'space',page:'space',render:async()=>{await UI.renderSpacePage();document.querySelector('#space-gantt')?.closest('.card')?.scrollIntoView({block:'start'});}},
  {id:'space-history',group:'space',label:'历史记录',module:'space',page:'space',render:()=>{SpaceProjects.filter='closed';return UI.renderSpacePage();}},
  {id:'gallery',group:'gallery',label:'作品销售',module:'gallery',render:()=>UI.renderGalleryPage()},
  {id:'artworks',group:'gallery',label:'作品档案',module:'products',page:'products',product:'gallery'},
  {id:'artists',group:'gallery',label:'艺术家资料',module:'artists',render:()=>ArtistLibrary.render()},
  {id:'creative-stock',group:'stock',label:'文创库存与采购',module:'products',page:'products',product:'creative'},
  {id:'inventory',group:'stock',label:'咖啡豆补货与盘点',module:'inventory',render:()=>InventoryInbox.render()},
  {id:'reports',group:'finance',label:'经营概览',module:'reports',render:()=>UI.renderReportsPage()},
  {id:'daily-closing',group:'finance',label:'日结核对',module:'daily-closing',render:()=>UI.renderDailyClosingPage()},
  {id:'expense',group:'finance',label:'支出记录',module:'expense',render:()=>UI.renderExpensePage()},
  {id:'operations',group:'finance',label:'日报／周报／月报',module:'operations',render:()=>OperationsDashboard.render()},
  {id:'products',group:'settings',label:'基础资料',module:'products',page:'products',product:'ticket',admin:true},
  {id:'manage',group:'settings',label:'数据维护',module:'manage',render:()=>UI.renderManagePage()},
  {id:'users',group:'settings',label:'用户权限',module:'users',render:()=>UI.renderUsersPage()},
  {id:'logs',group:'settings',label:'操作日志',module:'logs',render:()=>UI.renderLogsPage()}
 ],
 allowed(r){return Auth.isLoggedIn&&Auth.hasModuleAccess(r.module)&&(!r.admin||Auth.isAdmin);},
 productTabAllowed(tab){return this.current?.id==='products'?['ticket','coffee','workshop','spaces'].includes(tab):tab===this.current?.product;},
 applyAccess(){
  document.querySelectorAll('[data-nav-group]').forEach(b=>{b.hidden=!this.routes.some(r=>r.group===b.dataset.navGroup&&this.allowed(r));});
  if(this.current&&!this.allowed(this.current)){this.open(this.routes.find(r=>this.allowed(r))?.id);return;}
  if(this.current)this.renderChrome();
 },
 renderChrome(){
  const r=this.current;if(!r)return;
  document.querySelectorAll('[data-nav-group]').forEach(b=>{const selected=b.dataset.navGroup===r.group;b.classList.toggle('active',selected);if(selected)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  const title=this.groups.find(g=>g[0]===r.group)[1];
  document.getElementById('module-navigation').innerHTML=`<div class="module-heading"><h2>${title}</h2><span>${r.label}</span></div><nav class="module-tabs" aria-label="${title}功能">${this.routes.filter(x=>x.group===r.group&&this.allowed(x)).map(x=>`<button type="button" data-nav-route="${x.id}" class="module-tab${x.id===r.id?' active':''}" ${x.id===r.id?'aria-current="page"':''}>${x.label}</button>`).join('')}</nav>`;
  document.getElementById('main-area').dataset.navRoute=r.id;
 },
 async open(id){
  // A previous generic product link lands in the owning business when used there.
  if(id==='products'&&!Auth.isAdmin)id=UI._productTab==='gallery'?'artworks':'creative-stock';
  const r=this.routes.find(x=>x.id===id);if(!r||!this.allowed(r))return UI.toast('当前账号无权访问此功能','error');
  const epoch=++this.epoch;this.current=r;this.last[r.group]=id;
  if(id==='space')SpaceProjects.filter='active';
  if(r.product)UI._productTab=r.product;
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id==='page-'+(r.page||r.id)));
  document.querySelectorAll('.tab-btn[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===r.module));
  this.renderChrome();document.getElementById('sidebar')?.classList.remove('open');document.getElementById('sidebar-overlay')?.classList.remove('show');
  try{
   if(r.product)await UI.renderProductPage();else await r.render();
   // Ignore stale navigation completions; they may populate hidden pages but cannot take over location.
   if(epoch!==this.epoch)return;
   if(r.product)document.querySelectorAll('#product-sub-tabs [data-ptab]').forEach(b=>{b.hidden=!this.productTabAllowed(b.dataset.ptab);});
  }catch(e){if(epoch===this.epoch)UI.toast('页面加载失败：'+e.message,'error');console.error(e);}
 },
 openGroup(group){const routes=this.routes.filter(r=>r.group===group&&this.allowed(r));const id=this.last[group];return this.open(routes.find(r=>r.id===id)?.id||routes[0]?.id);}
};
window.AppNavigation=AppNavigation;
document.addEventListener('click',e=>{const group=e.target.closest('button[data-nav-group]');if(group)AppNavigation.openGroup(group.dataset.navGroup);const route=e.target.closest('button[data-nav-route]');if(route)AppNavigation.open(route.dataset.navRoute);});
