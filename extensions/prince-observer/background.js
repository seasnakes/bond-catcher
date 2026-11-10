'use strict';

const LOCAL_URL = 'http://127.0.0.1:5188';
const sources = {'http://103.120.91.153:81':['yiliao'],'https://mx.2026.naaifu.cn':['mx','news']};

async function postLocal(path, payload) {
  const response = await fetch(LOCAL_URL + path, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload), signal:AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error('本地服务响应 ' + response.status);
  return response.json();
}

// Only forward messages already present in the open page's DOM to localhost.
// Never fetch MX messages, open or reload MX tabs, or schedule remote polling.
chrome.runtime.onMessage.addListener((message,sender,reply) => {
  let origin;
  try { origin = new URL(sender.url).origin; } catch { return; }
  if (!sources[origin] || sender.id !== chrome.runtime.id || sender.frameId !== 0) return;
  if (message?.type !== 'prince-post' || !['/api/ingest','/api/heartbeat'].includes(message.path) ||
      !sources[origin].includes(message.payload?.source)) return;
  postLocal(message.path,message.payload).then(() => reply({ok:true})).catch(error => reply({ok:false,error:error.message}));
  return true;
});

chrome.action.onClicked.addListener(() => chrome.tabs.create({url:LOCAL_URL + '/'}));
