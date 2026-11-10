const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const extensionDir = path.join(__dirname, '../../extensions/prince-observer');
const background = fs.readFileSync(path.join(extensionDir, 'background.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));

async function main() {
  const mxScripts = manifest.content_scripts.find(item => item.matches.includes('https://mx.2026.naaifu.cn/*')).js;
  assert.deepEqual(mxScripts, ['collector.js', 'news-collector.js']);
  assert.equal(manifest.permissions.includes('alarms'), false);
  assert.equal(manifest.permissions.includes('scripting'), false);
  for (const name of mxScripts) {
    const source = fs.readFileSync(path.join(extensionDir, name), 'utf8');
    assert.equal(source.includes('loadMessages('), false);
    assert.equal(source.includes('mx-poll-now'), false);
  }

  let onMessage, onClick;
  const requests = [], openedTabs = [];
  const chrome = {
    runtime: {id:'test-extension', onMessage:{addListener(fn){onMessage=fn}}},
    action: {onClicked:{addListener(fn){onClick=fn}}},
    tabs: {create(options){openedTabs.push(options)}}
  };
  const fetch = async (url, options) => {
    requests.push({url, options});
    return {ok:true,json:async()=>({ok:true})};
  };
  vm.runInNewContext(background, {chrome,fetch,AbortSignal,URL});
  assert.equal(openedTabs.length, 0, 'loading the extension must not open MX');
  assert.equal(requests.length, 0, 'loading the extension must not poll MX');

  const sender = {url:'https://mx.2026.naaifu.cn/',id:'test-extension',frameId:0};
  assert.equal(onMessage({type:'mx-poll-now'},sender,()=>{}), undefined);
  assert.equal(requests.length, 0, 'old poll messages must be ignored');
  const replies = [];
  assert.equal(onMessage({type:'prince-post',path:'/api/heartbeat',payload:{source:'mx'}},sender,value=>replies.push(value)), true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://127.0.0.1:5188/api/heartbeat');
  assert.equal(replies[0].ok, true);
  assert.equal(onMessage({type:'prince-post',path:'/api/ingest',payload:{source:'mx'}},
    {url:'https://example.com/',id:'test-extension',frameId:0},()=>{}), undefined);
  assert.equal(requests.length, 1, 'unapproved origins must be ignored');

  onClick();
  assert.equal(openedTabs.length, 1);
  assert.equal(openedTabs[0].url, 'http://127.0.0.1:5188/');
  console.log('MX passive observer safety tests passed');
}

main().catch(error=>{console.error(error);process.exitCode=1;});
