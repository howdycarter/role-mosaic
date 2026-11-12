// Synthetic local-only applicant evidence. No production bypass is used for native tests.
import {writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {ApplicationStore,digest} from '../../src/applications.js';
import {registerTrackResume} from '../../src/packets.js';
import {loadEvidence,jobDigest,tracks} from '../../src/quality.js';
export async function seedQuality(home,job,resume){
 const store=new ApplicationStore(home),text='Synthetic product, design and engineering delivery example.';
 await writeFile(path.join(home,'synthetic-evidence.txt'),text);
 await store.write('career-evidence.json',{sources:[{id:'synthetic',path:'synthetic-evidence.txt',sha256:digest(text)}],facts:[{id:'synthetic-fact',sourceId:'synthetic',text,quote:text,verified:true,tracks,capabilities:[]}],caseStudies:[{id:'synthetic-case',tracks,evidenceIds:['synthetic-fact'],url:'https://example.invalid/case'}]});
 for(const track of tracks)await registerTrackResume({home,track,file:resume,confirm:'reviewed'});
 const evidence=await loadEvidence(home),reviews=await store.read('quality-reviews.json',{});
 reviews[job.id]={jobDigest:jobDigest(job),evidenceDigest:evidence.digest,resumeSha256:digest(await readFile(resume)),allMandatoryReviewed:true,reviewer:'Synthetic test reviewer',reviewedAt:new Date().toISOString(),requirements:[{text:'Synthetic delivery requirement',status:'supported',evidenceIds:['synthetic-fact']}]};
 await store.write('quality-reviews.json',reviews);
}
