const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const dir=path.join(__dirname,'../../extensions/prince-observer');
test('extension relays only matching sources and local ingest/heartbeat endpoints',async()=>{
 let listener; const calls=[];
 const event={addListener:()=>{}};
 const ctx={chrome:{runtime:{id:'test',onMessage:{addListener:f=>listener=f},onInstalled:event,onStartup:event},
  action:{onClicked:event},alarms:{onAlarm:event}},URL,AbortSignal,fetch:async(...args)=>{calls.push(args);return {ok:true,json:async()=>({})};}};
 vm.runInNewContext(fs.readFileSync(path.join(dir,'background.js'),'utf8'),ctx);
 const sender={id:'test',frameId:0,url:'https://mx.2026.naaifu.cn/#/pages/login/login'};
 const message={type:'prince-post',path:'/api/ingest',payload:{source:'mx',messages:[]}};
 for(const invalid of [{...message,path:'/api/other'},{...message,payload:{source:'yiliao'}}]) assert.equal(listener(invalid,sender,()=>{}),undefined);
 assert.equal(listener(message,{...sender,url:'https://example.org'},()=>{}),undefined);
 assert.equal(listener(message,{...sender,frameId:1},()=>{}),undefined);
 assert.equal(calls.length,0);
 const reply=await new Promise(resolve=>assert.equal(listener(message,sender,resolve),true));
 assert.equal(reply.ok,true);assert.equal(calls.length,1);assert.equal(calls[0][0],'http://127.0.0.1:5188/api/ingest');
});
test('installed and temporary observer use identical source',()=>{
 assert.equal(fs.readFileSync(path.join(dir,'collector.js'),'utf8'),fs.readFileSync(path.join(__dirname,'../../web/prince/collector.js'),'utf8'));
 const m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
 assert.deepEqual(m.host_permissions,['http://127.0.0.1/*','http://103.120.91.153/*','https://mx.2026.naaifu.cn/*']);
 assert.equal(m.content_scripts[0].run_at,'document_idle');
 assert(m.content_scripts.some(s=>s.js.includes('mx-pulse.js')));
});
test('offscreen transparent captcha iframe does not block a visible group',async()=>{
 async function status(rect,parentOpacity){
  const posts=[];
  const parent={parentElement:null,style:{display:'block',visibility:'visible',opacity:parentOpacity}};
  const frame={parentElement:parent,style:{display:'inline',visibility:'visible',opacity:'1'},getBoundingClientRect:()=>rect};
  const list={querySelectorAll:()=>[]};
  const document={body:{},querySelectorAll:s=>s.startsWith('iframe[')?[frame]:[],querySelector:s=>s==='.chat-header-content'?{textContent:'可转债技术交流群三群'}:s==='#messageScrollList'?list:null};
  const window={innerWidth:1200,innerHeight:800};
  const ctx={location:{origin:'http://103.120.91.153:81'},document,window,
   chrome:{runtime:{id:'installed-extension',sendMessage:async message=>{posts.push(message);return {ok:true};}}},
   MutationObserver:class{observe(){}disconnect(){}},getComputedStyle:e=>e.style,
   setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>{},Date,Map,Number,String,JSON,Promise,Error};
  vm.runInNewContext(fs.readFileSync(path.join(dir,'collector.js'),'utf8'),ctx);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(window.__princeCollector.error,null);
  return posts.at(-1).payload.status;
 }
 assert.equal(await status({x:0,y:-1000000,width:300,height:150,right:300,bottom:-999850,top:-1000000,left:0},'0'),'observing_page');
 assert.equal(await status({x:100,y:100,width:300,height:150,right:400,bottom:250,top:100,left:100},'1'),'captcha_blocked');
});
