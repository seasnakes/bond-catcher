/* Read-only observer: never sends messages to the source group. */
(() => {
  const source = location.origin === 'https://mx.2026.naaifu.cn' ? 'news' : null;
  if (!source) throw new Error('原站地址不匹配');
  const extension = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  // A content script and temporary page script can coexist briefly; server deduplicates by ID.
  const transport = extension ? 'extension' : 'temporary';
  if (window.__newsCollector) window.__newsCollector.stop();
  const endpoint = 'http://127.0.0.1:5188';
  const channel = '快讯八合一';
  const author = '快讯八合一';
  const started = Date.now();
  const ack = new Map();
  let busy = false, stopped = false, timer;
  const state = { startedAt: new Date(started).toISOString(), lastSuccess: null, error: null, stop };
  function stop() { stopped = true; observer.disconnect(); clearInterval(timer); }
  function textWithEmoji(element) {
    const copy=element.cloneNode(true);
    for (const img of copy.querySelectorAll('img')) img.replaceWith(document.createTextNode(img.alt || '[图片]'));
    for (const br of copy.querySelectorAll('br')) br.replaceWith(document.createTextNode('\n'));
    return copy.textContent;
  }
  async function post(path, payload) {
    if (extension) {
      const reply = await chrome.runtime.sendMessage({type:'prince-post', path, payload});
      if (!reply?.ok) throw new Error(reply?.error || '本地服务未响应');
      return;
    }
    const res=await fetch(endpoint+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)});
    if (!res.ok) throw new Error('存档服务响应 '+res.status);
  }
  function extractMx() {
    if (document.querySelector('.chat-title-block h2')?.textContent.trim() !== channel) return {status:'wrong_channel',messages:[]};
    const messages=[...document.querySelectorAll('.message-anchor')].map(e=>{
      const body=[...e.querySelectorAll('.bubble .text-part')].map(textWithEmoji).join('\n').trim();
      const key=e.dataset.messageKey || '';
      const rawTime=key.slice((e.dataset.messageId || '').length+1).replace(/-\d+$/,'');
      const timestampMs=/^\d{13}$/.test(rawTime)?Number(rawTime):Date.parse(rawTime.replace(' ','T')+'+08:00');
      return {id:'news-'+e.dataset.messageId,author,body,
        images:[...e.querySelectorAll('.bubble .image-part img')].map(i=>i.src),
        timestampMs, displayedTime:e.querySelector('time')?.textContent || null};
    }).filter(m=>/^news-\d+$/.test(m.id) && Number.isFinite(m.timestampMs));
    return {status:document.querySelector('.message-anchor')?'observing_page':'missing_messages',messages};
  }
  function extract() {
    return extractMx();
  }
  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      const snapshot = extract();
      const pending = snapshot.messages.filter(m=>ack.get(m.id)!==JSON.stringify(m));
      // Initial messages and older paginated records must never be treated as new signals.
      for (const mode of ['history','observed']) {
        const batch = pending.filter(m=>(m.timestampMs >= started ? 'observed':'history') === mode);
        if (!batch.length) continue;
        await post('/api/ingest',{source,channel,mode,messages:batch});
        for (const m of batch) ack.set(m.id,JSON.stringify(m));
      }
      await post('/api/heartbeat',{source,transport,status:snapshot.status,startedAt:state.startedAt,visibleCount:snapshot.messages.length});
      state.lastSuccess = new Date().toISOString(); state.error = null;
    } catch(e) { state.error=String(e.message); }
    finally { busy=false; }
  }
  let scheduled = false;
  const observer = new MutationObserver(()=>{
    if (!scheduled) { scheduled=true; setTimeout(()=>{scheduled=false;tick();},150); }
  });
  observer.observe(document.body,{childList:true,subtree:true,characterData:true});
  timer=setInterval(tick,5000);
  window.__newsCollector=state;
  tick();
  return '采集观察器已启动：'+source+' / '+transport;
})();
