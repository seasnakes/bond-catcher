const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const extension = path.resolve(__dirname, '../../extensions/prince-observer');
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json')));
assert(manifest.content_scripts.some(s => s.matches.includes('https://mx.2026.naaifu.cn/*') && s.js.includes('mx-pulse.js')));

async function main() {
  let listener, alarmListener;
  const requests = [];
  const saved = {};
  const now = Date.now();
  const rooms = {
    activeRoomId:20099,
    list:[{id:20530,title:'转债小王子'},{id:20099,title:'快讯八合一'}],
    messagesByRoom:{
      20530:[{id:100,createtime:now,msg:JSON.stringify([{type:'text',msg:'小王子历史'}])}],
      20099:[{id:200,createtime:now,msg:JSON.stringify([{type:'text',msg:'快讯历史'}])}]
    },
    async loadMessages() {}
  };
  const document = {querySelector:() => ({__vue_app__:{config:{globalProperties:{$pinia:{_s:new Map([['rooms',rooms]])}}}}})};
  const event = {addListener(){}};
  const chrome = {
    runtime:{id:'installed-extension',onMessage:{addListener(fn){listener=fn;}},onInstalled:event,onStartup:event},
    action:{onClicked:event},
    tabs:{query:async()=>[{id:7,discarded:false}],update:async(_id,options)=>{assert.equal(options.autoDiscardable,false);},create:async()=>{throw Error('existing tab should be used');}},
    scripting:{executeScript:async options=>[{result:await options.func(...options.args)}]},
    storage:{local:{get:async()=>({mxWatermarks:saved.mxWatermarks}),set:async value=>Object.assign(saved,value)}},
    alarms:{create(){},onAlarm:{addListener(fn){alarmListener=fn;}}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(extension,'background.js'),'utf8'),{
    chrome,document,location:{origin:'https://mx.2026.naaifu.cn'},URL,Date,Number,String,JSON,Array,Math,Promise,AbortSignal,
    fetch:async (url,options)=>{requests.push({url,payload:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true})};}
  });
  const sender={url:'https://mx.2026.naaifu.cn/#/pages/login/login',id:chrome.runtime.id,frameId:0};
  const pulse=()=>new Promise(resolve=>assert.equal(listener({type:'mx-poll-now'},sender,resolve),true));
  assert.equal((await pulse()).ok,true);
  assert.equal(requests.filter(r=>r.url.endsWith('/api/ingest')).length,0,'first poll seeds the watermark without sending history');
  assert.equal(saved.mxWatermarks.mx,100);
  assert.equal(saved.mxWatermarks.news,200);
  assert.equal(rooms.activeRoomId,20099,'polling must not switch the visible channel');
  rooms.messagesByRoom[20530].push({id:101,createtime:now+1000,msg:JSON.stringify([{type:'text',msg:'小王子新消息'}])});
  rooms.messagesByRoom[20099].push({id:201,createtime:now+1000,msg:JSON.stringify([{type:'text',msg:'快讯新消息'}])});
  assert.equal((await pulse()).ok,true);
  const ingests=requests.filter(r=>r.url.endsWith('/api/ingest'));
  assert.deepEqual(ingests.map(r=>r.payload.source),['mx','news']);
  assert(ingests.every(r=>r.payload.mode==='observed'));
  assert.deepEqual(ingests.map(r=>r.payload.messages[0].id),['mx-101','news-201']);
  assert.equal(saved.mxWatermarks.mx,101);
  assert.equal(saved.mxWatermarks.news,201);
  assert.equal(rooms.activeRoomId,20099);
  assert.equal((await pulse()).ok,true);
  assert.equal(requests.filter(r=>r.url.endsWith('/api/ingest')).length,2,'repeat polling is idempotent');
  assert.equal(typeof alarmListener,'function');
  console.log('MX two-channel background poller ok');
}
main().catch(error => { console.error(error); process.exitCode=1; });
