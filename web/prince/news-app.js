'use strict';
const el=id=>document.getElementById(id),date=s=>s?new Date(s).toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}):'—';
const labels={square_bracket:'英文/全角方括号',short_bracket_label:'不超过6字的短标签',broker_heading:'券商团队标题',explicit_recommendation:'明确荐股措辞',broker_marketing:'券商推广联系信息',valuation_pitch:'目标价/市值测算推荐',research_update:'券商观点或调研更新',roadshow_invitation:'路演邀约',image_requires_review:'图片内容待核对',empty_or_disclaimer:'空内容/仅免责声明',possible_investment_commentary:'疑似投资评论'};
let data;
function node(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
function render(){
  const rows=(data?.messages||[]).filter(r=>(!el('action').value||r.filter.action===el('action').value)&&r.body.includes(el('search').value));
  el('messages').replaceChildren(...rows.map(r=>{
    const a=node('article');
    a.append(node('div',`${date(r.published_at)} · ${{allow:'通过',filter:'已过滤',review:'待核对'}[r.filter.action]} · ${r.mode==='history'?'历史，仅存档':'新到'} · ${r.id}`));
    const delivery=(r.delivery||[]).map(v=>`${v.kind==='image'?'图片':'文字'}${{sent:'已发',pending:'待发',needs_review:'发送待核对',filtered:'已取消'}[v.state]||v.state}${v.count>1?' ×'+v.count:''}`).join(' · ');
    const oldImage=r.images.length&&data.notifications.imageEnabledAt&&Date.parse(r.first_seen)<Date.parse(data.notifications.imageEnabledAt);
    const noDelivery=r.mode==='history'?'历史不推送':r.filter.action!=='allow'?'过滤/待核对未推送':oldImage?'切换前带图，不补发':'无发送记录';
    a.append(node('small',r.filter.reasons.map(v=>labels[v]||v).join('；')||'未命中过滤规则'));
    a.append(node('small',delivery||noDelivery));
    a.append(node('p',r.display_body||'（仅图片）'));
    for(const url of r.images){
      const name=data.media[url.split('?')[0]];
      if(name){const img=node('img');img.src='/media/'+name;img.loading='lazy';a.append(img);}
      else a.append(node('small','图片尚未归档'));
    }
    return a;
  }));
}
async function refresh(){try{const r=await fetch('/api/news');if(!r.ok)throw Error(r.status);data=await r.json();const h=data.heartbeat,n=data.notifications;const live=Date.now()-Date.parse(h.at)<(h.transport==='mx_api'?75000:20000);const state=live?({observing_api:'两频道后台读取中',auth_required:'MX 登录失效，请重新登录',missing_room:'找不到快讯八合一频道',source_error:'MX 读取失败，等待重试',gap_truncated:'断线积压超过回补上限，请核对',observing_page:'观察器运行中（不代表原站有新消息）',wrong_channel:'页面未选中快讯八合一',missing_messages:'目标频道未加载消息'}[h.status]||'状态异常'):'未接入或心跳过期';el('status').textContent=`观察器：${state} · 心跳 ${date(h.at)} · 原站最新 ${date(h.latestMessageMs)} · 页面最后入库 ${date(data.latestBySource.news?.published_at)} · 飞书 ${n.chat_name||'未配置'} · 已发 ${n.counts.sent||0} · 待发 ${n.counts.pending||0} · 等待图片 ${n.waitingMedia||0} · 待核对发送 ${n.counts.needs_review||0}`;el('stats').textContent=`原始消息 ${data.total} · 通过 ${data.filterCounts.allow||0} · 过滤 ${data.filterCounts.filter||0} · 待核对 ${data.filterCounts.review||0}（含历史样本，非发送数量）`;render();}catch(e){el('status').textContent='服务不可用：'+e.message;}}
el('action').addEventListener('change',render);el('search').addEventListener('input',render);refresh();setInterval(refresh,5000);
