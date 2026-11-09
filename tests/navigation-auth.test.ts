import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextPage } from '../src/browser/formRunner.js';
import * as report from '../src/browser/report.js';
import * as session from '../src/browser/session.js';
import type { Profile } from '../src/profile/schema.js';
import type { Job } from '../src/jobs/normalize.js';
import type { JevClient } from '../src/jev/client.js';

const original = process.env.CODEX_LEADERSHIP;
afterEach(() => { vi.restoreAllMocks(); if (original === undefined) delete process.env.CODEX_LEADERSHIP; else process.env.CODEX_LEADERSHIP=original; });
describe('ambiguous Next/Continue authorization', () => {
  it.each([{dry:false},{dry:true,submit:true},{dry:false,submit:true,leadership:true},{dry:false,submit:true,noJournal:true}])('holds before attaching to a page when authorization is absent or blocked: %j', async opts => {
    const first = {jobId:'synthetic',state:'filled',ready:true,hasNext:true,failed:[],drafts:[],reviews:[],missingRequired:[],fields:[],leftBlank:[],earlier:[],page:1} as unknown as report.FillReport;
    vi.spyOn(report,'loadReport').mockReturnValue(first);
    vi.spyOn(report,'loadPlan').mockReturnValue({plan:{submitSelectors:['#final /* Continue */']},dump:{}} as unknown as ReturnType<typeof report.loadPlan>);
    vi.spyOn(report,'pickNext').mockReturnValue({selector:'#final',text:'Continue'});
    vi.spyOn(report,'isClean').mockReturnValue(true);
    vi.spyOn(report,'saveReport').mockImplementation(r=>r);
    const page = vi.spyOn(session,'pageFor').mockRejectedValue(Error('Must not reach browser'));
    if ('leadership' in opts) process.env.CODEX_LEADERSHIP='1'; else delete process.env.CODEX_LEADERSHIP;
    const result = await nextPage({} as JevClient,{} as Profile,{id:'synthetic'} as Job,'noJournal' in opts ? opts : {...opts,onClick:vi.fn()});
    expect(result.ready).toBe(false);expect(result.reason).toMatch(/explicit submission authorization/);
    expect(page).not.toHaveBeenCalled();
  });
});

it('journals before an authorized Continue click and preserves unknown after a click failure',async()=>{
 delete process.env.CODEX_LEADERSHIP;
 const events:string[]=[];
 const first={jobId:'synthetic',state:'filled',ready:true,hasNext:true,failed:[],fields:[],earlier:[],page:1} as unknown as report.FillReport;
 vi.spyOn(report,'loadReport').mockReturnValue(first);
 vi.spyOn(report,'loadPlan').mockReturnValue({plan:{submitSelectors:[]},dump:{url:'https://example.invalid/apply',fields:[],submitSelectors:[]}} as unknown as ReturnType<typeof report.loadPlan>);
 vi.spyOn(report,'pickNext').mockReturnValue({selector:'#final',text:'Continue'});
 vi.spyOn(report,'isClean').mockReturnValue(true);vi.spyOn(report,'saveReport').mockImplementation(r=>r);
 const fake={writesSettled:async()=>true,awj:async()=>({ok:true,x:1,y:1}),click:async()=>{events.push('click');throw Error('connection lost')},close:()=>events.push('close')};
 vi.spyOn(session,'pageFor').mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof session.pageFor>>);
 vi.spyOn(session,'inFront').mockImplementation(async(_page,fn)=>fn());
 const result=await nextPage({} as JevClient,{} as Profile,{id:'synthetic'} as Job,{dry:false,submit:true,onClick:()=>{events.push('journal-unknown')}});
 expect(events).toEqual(['journal-unknown','click','close']);
 expect(result.submissionUncertain).toBe(true);expect(result.hasNext).toBe(false);
});
