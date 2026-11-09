import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { BROWSER } from '../src/config.js';
import { printPdf } from '../src/documents/render.js';

it.skipIf(!existsSync(BROWSER.chromePath))('private PDF printing blocks scripts and active/passive outbound requests with real Chrome',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'mosaic-print-test-'));
 let requests=0;
 const server=createServer((_req,res)=>{requests++;res.end('external');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw Error('No listener');
 const url=`http://127.0.0.1:${address.port}`;
 try {
  const file=path.join(dir,'review.pdf');
  const pages=await printPdf(`<html><head><style>@import url('${url}/css');body{background-image:url('${url}/background')}</style></head><body><h1>Synthetic career fixture</h1><script>fetch('${url}/script');document.body.textContent='SCRIPT EXECUTED';</script><img src='${url}/image' onerror="fetch('${url}/handler')"><iframe src='${url}/frame'></iframe></body></html>`,file);
  expect(pages).toBeGreaterThan(0);expect(requests).toBe(0);
  expect(readFileSync(file).subarray(0,5).toString()).toBe('%PDF-');
  expect(statSync(file).mode&0o777).toBe(0o600);
 } finally { await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(dir,{recursive:true,force:true}); }
},20000);
