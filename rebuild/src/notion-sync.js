import {ApplicationStore,digest} from './applications.js';

export function notionPageId(value){const id=String(value||'').replaceAll('-','');if(!/^[a-f0-9]{32}$/i.test(id))throw Error('Enter the Notion page ID (32 hexadecimal characters)');return id;}
export async function syncNotion({home,token,pageId,fetcher=fetch,saveConnection=false}={}){
 const store=new ApplicationStore(home),saved=await store.read('notion-connection.json',{}),credentials=await store.read('notion-credentials.json',{});
 const id=notionPageId(pageId||saved.pageId),secret=token||process.env.NOTION_API_KEY||credentials.token;
 if(typeof secret!=='string'||!secret.trim())throw Error('Mosaic needs its own Notion integration token; the chat connection cannot be used by its worker');
 if(!/^[a-zA-Z0-9_-]{20,200}$/.test(secret.trim()))throw Error('Notion token format is invalid');
 const get=async route=>{
  const response=await fetcher('https://api.notion.com/v1/'+route,{headers:{Authorization:'Bearer '+secret.trim(),'Notion-Version':'2026-03-11'},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw Error('Notion returned HTTP '+response.status+'; check integration access to the selected page');
  const text=await response.text();if(Buffer.byteLength(text)>2*1024*1024)throw Error('Notion response exceeds the import limit');return JSON.parse(text);
 };
 const page=await get('pages/'+id),lines=[],unsupported=new Set();let requests=0,blocks=0;
 const children=async(parent,depth=0)=>{
  if(depth>12)throw Error('Notion page nesting exceeds the import limit');let cursor;
  do{
   if(++requests>40)throw Error('Notion import exceeds the request limit');
   const data=await get('blocks/'+parent+'/children?page_size=100'+(cursor?'&start_cursor='+encodeURIComponent(cursor):''));
   if(!Array.isArray(data.results))throw Error('Unexpected Notion block response');
   for(const block of data.results){
    if(++blocks>3000)throw Error('Notion import exceeds the block limit');
    const content=block[block.type],rich=content?.rich_text;
    if(Array.isArray(rich))lines.push(rich.map(r=>r.plain_text??r.text?.content??'').join(''));
    else if(block.type==='child_page')lines.push('[Linked child page: '+content.title+']');
    else if(!['divider','table','column','column_list'].includes(block.type))unsupported.add(block.type);
    if(block.has_children&&block.type!=='child_page')await children(block.id,depth+1);
   }
   cursor=data.has_more?data.next_cursor:null;if(data.has_more&&!cursor)throw Error('Notion pagination did not provide a cursor');
  }while(cursor);
 };
 await children(id);
 const text=lines.join('\n\n');if(Buffer.byteLength(text)>2*1024*1024)throw Error('Notion career text exceeds the import limit');
 const title=Object.values(page.properties||{}).find(p=>p.type==='title')?.title?.map(r=>r.plain_text??r.text?.content??'').join('')||'Career history';
 const snapshot={url:page.url,title,text,syncedAt:new Date().toISOString(),pageLastEditedAt:page.last_edited_time,source:'Mosaic direct Notion integration',sha256:digest(text),approved:false,unsupportedBlockTypes:[...unsupported]};
 await store.write('notion-resume.json',snapshot);await store.write('notion-current.json',snapshot);
 if(saveConnection){if(token)await store.write('notion-credentials.json',{token:secret.trim()});await store.write('notion-connection.json',{pageId:id,enabled:true});}
 return {syncedAt:snapshot.syncedAt,title,blocks,unsupportedBlockTypes:snapshot.unsupportedBlockTypes,approved:false};
}
