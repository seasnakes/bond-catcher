/* Read-only observer: never sends messages to the source group. */
(() => {
  const source = location.origin === 'http://103.120.91.153:81' ? 'yiliao' : location.origin === 'https://mx.2026.naaifu.cn' ? 'mx' : null;
  if (!source) throw new Error('原站地址不匹配');
  const extension = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  // A content script and temporary page script can coexist briefly; server deduplicates by ID.
  const transport = extension ? 'extension' : 'temporary';
  if (window.__princeCollector) window.__princeCollector.stop();
  const endpoint = 'http://127.0.0.1:5188';
  const channel = source === 'yiliao' ? '可转债技术交流群三群' : '转债小王子';
  const author = '转债小王子1';
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
      const key=e.dataset.messageKey?.split('-');
      return {id:'mx-'+e.dataset.messageId,author,body:body.replace(/^转债小王子1(?:[\r\n]+|$)/,''),
        images:[...e.querySelectorAll('.bubble .image-part img')].map(i=>i.src),
        timestampMs:Number(key?.[1]), displayedTime:e.querySelector('time')?.textContent || null};
    }).filter(m=>/^mx-\d+$/.test(m.id) && Number.isFinite(m.timestampMs));
    return {status:document.querySelector('.message-anchor')?'observing_page':'missing_messages',messages};
  }
  function extract() {
    if (source === 'mx') return extractMx();
    const captcha = [...document.querySelectorAll('iframe[src*="turing.captcha.gtimg.com"]')]
      .some(frame => {
        const rect = frame.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20 || rect.bottom <= 0 || rect.right <= 0 ||
            rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;
        for (let node = frame; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.05) return false;
        }
        return true;
      });
    if (captcha) return {status:'captcha_blocked',messages:[]};
    const title = document.querySelector('.chat-header-content')?.textContent.trim();
    if (title !== channel) return {status:'wrong_channel',messages:[]};
    const list = document.querySelector('#messageScrollList');
    if (!list) return {status:'missing_messages',messages:[]};
    const messages = Array.from(list.querySelectorAll(':scope > li')).filter(e=>e.querySelector('.message-body-nick-name')?.textContent.trim() === author).map(e=>({
      id:e.id, author,
      body:Array.from(e.querySelectorAll('.message-text-container')).map(textWithEmoji).join('\n'),
      images:Array.from(e.querySelectorAll('img.message-image')).map(i=>i.src),
      displayedTime:e.querySelector('.message-timestamp')?.textContent || null
    })).filter(m=>/^tui-\d+-\d+-\d+$/.test(m.id));
    return {status:'observing_page',messages};
  }
  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      const snapshot = extract();
      const pending = snapshot.messages.filter(m=>ack.get(m.id)!==JSON.stringify(m));
      // Initial messages and older paginated records must never be treated as new signals.
      for (const mode of ['history','observed']) {
        const batch = pending.filter(m=>((source==='mx' ? m.timestampMs : Number(m.id.split('-')[2])*1000) >= started ? 'observed':'history') === mode);
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
  window.__princeCollector=state;
  tick();
  return '采集观察器已启动：'+source+' / '+transport;
})();
