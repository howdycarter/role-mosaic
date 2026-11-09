import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { historyRefusal } from '../src/jobs/history.js';

describe('Imported history gate', () => {
  it('holds matched roles and fails closed when the snapshot is missing or invalid', () => {
    const dir=mkdtempSync(path.join(tmpdir(),'jev-history-'));
    try {
      const file=path.join(dir,'history.json');
      const job={company:'Example Co',title:'Director, Product Design',url:'https://jobs.lever.co/example/aaa'};
      expect(historyRefusal(job,file)).toMatch(/missing/);
      writeFileSync(file,JSON.stringify({applications:[{company:'Example Co',role:'Director Product Design',status:'submitted',posting:'https://example.com/old'}]}));
      expect(historyRefusal(job,file)).toMatch(/submitted/);
      expect(historyRefusal({...job,title:'VP Design'},file)).toBeNull();
      writeFileSync(file,'{}');
      expect(historyRefusal(job,file)).toMatch(/invalid/);
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
});
