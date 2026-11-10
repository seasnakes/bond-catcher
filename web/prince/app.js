'use strict';
const el=id=>document.getElementById(id);
const date=s=>s?new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
let snapshot;
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function render(){
 const rows=(snapshot?.messages||[]).filter(r=>r.body.includes(el('search').value) && (!el('source').value || r.source===el('source').value));
 el('messages').replaceChildren(...rows.map(r=>{
  const a=node('article');a.append(node('div',`${r.source==='mx'?'MX':'益聊原站'} · ${date(r.published_at)} · ${r.mode==='history'?'历史补录':'页面新到'} · ${r.author}`,'meta'));
  a.append(node('p',r.body||'图片消息','body'));
  for(const url of r.images){const img=node('img');img.src='/media/'+snapshot.media[url.split('?')[0]];img.loading='lazy';img.alt='原消息图片';
   if(snapshot.media[url.split('?')[0]]){const link=node('a');link.href=img.src;link.target='_blank';link.append(img);a.append(link);}else a.append(node('small','图片尚未归档 / 等待重试'));}
  a.append(node('div',`首次存档 ${date(r.first_seen)} · ${r.id}`,'meta'));return a;
 }));
}
async function refresh(){try{
 const r=await fetch('/api/messages');if(!r.ok)throw new Error(r.status);snapshot=await r.json();
 const n=snapshot.notifications; el('notifications').textContent=n?.enabled?`飞书机器人 → ${n.chat_name} · 已发送 ${n.counts.sent||0} · 待发 ${n.counts.pending||0} · 等待图片 ${n.waitingMedia||0} · 待人工核对 ${n.counts.needs_review||0}${n.last?.error?' · '+n.last.error:''}。${n.dualSource?'益聊 + MX 双来源，先入库者推送，同内容在两分钟内去重。':'益聊单来源推送。'}历史补录不推送。`:'飞书推送未启用';
 el('status').textContent=['yiliao','mx'].map(source=>{
  const hb=snapshot.sourceHeartbeats?.[source];const fresh=hb&&Date.now()-Date.parse(hb.at)<(hb.transport==='mx_api'?75000:20000);
  const label=source==='yiliao'?'益聊':'MX';
  const state=!fresh?'心跳过期或未接入':hb.status==='captcha_blocked'?'安全验证阻断，请在原站自行完成验证码':hb.status==='observing_api'?'两频道后台读取中':hb.status==='auth_required'?'MX 登录失效，请重新登录':hb.status==='missing_room'?'找不到目标频道':hb.status==='source_error'?'MX 读取失败：'+(hb.error||'待重试'):hb.status==='gap_truncated'?'断线积压超过回补上限，请核对':hb.status==='observing_page'?'观察器运行中（不代表源站有新消息）':'请切回目标频道';
  const connection=!fresh?'检查 Chrome 是否运行及扩展是否启用':hb?.transport==='mx_api'?'后台定时检查，不需要停留目标频道':hb?.transport==='extension'?'扩展已接入':'临时接入，刷新会失效';
  return `${label}：${state} · ${connection} · 心跳 ${date(hb?.at)}${hb?.transport==='mx_api'?' · 原站最新 '+date(hb.latestMessageMs):''} · 最后入库 ${date(snapshot.latestBySource?.[source]?.published_at)}`;
 }).join(' ｜ ');
 el('stats').replaceChildren(...[['已存消息',snapshot.total],['已归档图片',Object.keys(snapshot.media).length],['当前展示',snapshot.messages.length]].map(([k,v])=>{const n=node('div',k,'stat');n.append(node('b',String(v)));return n;}));
 el('events').textContent=snapshot.events.map(e=>date(e.at)+' '+e.detail).join('\n');render();
}catch(e){el('status').textContent='本地存档服务不可用：'+e.message;}}
el('source').addEventListener('change',render);
el('search').addEventListener('input',render);refresh();setInterval(refresh,5000);
