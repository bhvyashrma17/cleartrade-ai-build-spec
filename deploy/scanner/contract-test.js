/**
 * Contract test for deploy/scanner/server.js.
 *
 * Runs the real server against a fake clamd that speaks the actual INSTREAM wire protocol.
 * This proves the HTTP contract and every fail-closed path WITHOUT needing Docker or a real
 * virus engine, so it can run in CI.
 *
 * What it does NOT prove: that ClamAV itself detects real malware. That is established by the
 * live EICAR check in scripts/verify-staging-scanner.ts against the deployed service.
 *
 *   node deploy/scanner/contract-test.js
 */

// Exercises deploy/scanner/server.js against a fake clamd speaking real INSTREAM.
const net=require('node:net'), {spawn}=require('node:child_process');
const EICAR='EICAR-STANDARD-ANTIVIRUS-TEST-FILE';
let mode='clean';

const clamd=net.createServer(sock=>{
  let buf=Buffer.alloc(0), cmd=null;
  sock.on('data',d=>{
    buf=Buffer.concat([buf,d]);
    if(!cmd){
      const z=buf.indexOf(0);
      if(z<0)return;
      cmd=buf.subarray(1,z).toString(); buf=buf.subarray(z+1);
      if(cmd==='PING'){sock.end('PONG\0');cmd=null;return;}
      if(cmd==='VERSION'){sock.end('ClamAV 1.4.2/27000/Mon Aug 17 2026\0');cmd=null;return;}
    }
    if(cmd==='INSTREAM'){
      // terminator = 4 zero bytes at the end
      if(buf.length>=4 && buf.readUInt32BE(buf.length-4)===0){
        const payload=buf.toString('latin1');
        if(mode==='error'){sock.end('INSTREAM size limit exceeded. ERROR\0');return;}
        if(payload.includes(EICAR))sock.end('stream: Win.Test.EICAR_HDB-1 FOUND\0');
        else sock.end('stream: OK\0');
      }
    }
  });
});

const results=[];
const check=(n,ok,d)=>{results.push({n,ok,d});console.log(`  ${ok?'PASS':'FAIL'}  ${n.padEnd(46)} ${d}`);};

clamd.listen(13310,'127.0.0.1',()=>{
  const srv=spawn(process.execPath,['deploy/scanner/server.js'],{env:{...process.env,PORT:'13000',CLAMD_HOST:'127.0.0.1',CLAMD_PORT:'13310',SCANNER_AUTH_TOKEN:'tok-abcdefghijklmnop',SCANNER_MAX_BYTES:'1024'},stdio:['ignore','pipe','pipe']});
  srv.stderr.on('data',d=>process.stderr.write(d));
  setTimeout(run.bind(null,srv),600);
});

async function post(body,headers={}){
  return fetch('http://127.0.0.1:13000/scan',{method:'POST',headers:{'content-type':'application/octet-stream',authorization:'Bearer tok-abcdefghijklmnop',...headers},body});
}

async function run(srv){
  try{
    let r=await fetch('http://127.0.0.1:13000/health/ready'); let j=await r.json();
    check('readiness reports engine version',r.ok&&j.version==='1.4.2/27000',`version=${j.version}`);

    r=await post(Buffer.from('%PDF-1.4 harmless')); j=await r.json();
    check('clean file -> clean:true',r.status===200&&j.clean===true,`clean=${j.clean} engine=${j.engine}/${j.version}`);

    r=await post(Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$'+EICAR+'!$H+H*')); j=await r.json();
    check('EICAR -> clean:false with signature',r.status===200&&j.clean===false&&!!j.signature,`signature=${j.signature}`);

    r=await post(Buffer.from('x'.repeat(5000))); 
    check('oversize -> 413, never scanned as clean',r.status===413,`status=${r.status}`);

    r=await post(Buffer.from('data'),{authorization:'Bearer wrong-token-value'});
    check('bad credential -> 401',r.status===401,`status=${r.status}`);

    r=await post(Buffer.from(''));
    check('empty body -> 400',r.status===400,`status=${r.status}`);

    mode='error';
    r=await post(Buffer.from('anything')); 
    check('clamd ERROR -> non-2xx (never clean)',r.status>=400,`status=${r.status}`);
    mode='clean';

    // clamd down entirely
    await new Promise(res=>clamd.close(res));
    r=await post(Buffer.from('%PDF-1.4'));
    check('clamd unreachable -> non-2xx (never clean)',r.status>=400,`status=${r.status}`);
    r=await fetch('http://127.0.0.1:13000/health/ready');
    check('readiness fails when clamd is down',r.status===503,`status=${r.status}`);
  }catch(e){check('harness',false,String(e));}
  finally{
    srv.kill();
    const bad=results.filter(x=>!x.ok).length;
    console.log(`\n${results.length-bad}/${results.length} scanner contract checks passed.`);
    process.exit(bad?1:0);
  }
}
