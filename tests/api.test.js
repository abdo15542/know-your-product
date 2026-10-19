import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const port=43127;
test('API health and input validation',async t=>{
 const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port)},stdio:'ignore'});
 t.after(()=>child.kill('SIGTERM'));
 await new Promise((resolve,reject)=>{const start=Date.now();const tick=async()=>{try{const r=await fetch('http://127.0.0.1:'+port+'/api/health');if(r.ok)return resolve()}catch{}if(Date.now()-start>8000)return reject(new Error('server did not start'));setTimeout(tick,100)};tick()});
 const health=await fetch('http://127.0.0.1:'+port+'/api/health');assert.equal(health.status,200);assert.equal((await health.json()).ok,true);
 const bad=await fetch('http://127.0.0.1:'+port+'/api/product/not-a-barcode');assert.equal(bad.status,400);
 const short=await fetch('http://127.0.0.1:'+port+'/api/search?q=a');assert.equal(short.status,400);
});
