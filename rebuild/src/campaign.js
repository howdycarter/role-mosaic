import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {ApplicationStore,digest,postingKey,samePosting} from './applications.js';

import {confirmedReceipt} from './outcomes.js';

/** A campaign target counts employer receipts, independently of daily limits. */
export async function campaignProgress({home,now=new Date()}) {
 const store=new ApplicationStore(home),config=await store.read('campaign.json',null);
 if(!config?.enabled)return {enabled:false,complete:false};
 if(!Number.isInteger(config.targetConfirmed)||config.targetConfirmed<1||config.targetConfirmed>10000||!Number.isFinite(Date.parse(config.since)))throw Error('Invalid campaign target or starting timestamp');
 const since=Date.parse(config.since);
 const end=config.endsAt===undefined ? Infinity : Date.parse(config.endsAt);
 if(!(end>since))throw Error('Invalid campaign end timestamp');
 const inWindow=time=>time>=since && time<end;
 const ledger=await store.read('application-ledger.json',[]),confirmed=new Set(),unknown=new Set();
 for(const attempt of ledger){
  const receipt=confirmedReceipt(attempt);
  if(receipt && inWindow(receipt.time))confirmed.add(receipt.key);
  else if(attempt.status==='submission_unknown' && inWindow(Date.parse(attempt.finalActionAt??attempt.createdAt)) && samePosting(attempt.url,attempt.url))unknown.add(postingKey(attempt.url));
 }
 for(const source of config.importedReceipts||[]){
  const bytes=await readFile(path.resolve(home,source.file));
  if(digest(bytes)!==source.sha256)throw Error('Imported campaign receipt changed; verify its evidence before continuing');
  const record=JSON.parse(bytes),at=Date.parse(record.recordedAt||record.submittedAt);
  if(!samePosting(record.posting,source.posting)||record.status!=='submitted'||!Number.isFinite(at)||at<Date.parse(config.since)||!/application (?:was successfully submitted|has been received|submitted successfully)/i.test(record.confirmation||''))throw Error('Imported campaign receipt lacks matching employer confirmation');
  if(inWindow(at))confirmed.add(postingKey(record.posting));
 }
 for(const key of confirmed)unknown.delete(key);
 const expired=now.getTime()>=end;
 return {enabled:true,expired,endsAt:config.endsAt,targetConfirmed:config.targetConfirmed,since:config.since,confirmed:confirmed.size,unknown:unknown.size,remaining:Math.max(0,config.targetConfirmed-confirmed.size),complete:confirmed.size>=config.targetConfirmed};
}
