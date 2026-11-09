export function optionForAnswer(field,answer,options){
 const value=String(answer),label=field.label.replace(/[*:]/g,'').trim().toLowerCase();
 const exact=options.find(s=>s.toLowerCase()===value.toLowerCase());if(exact)return exact;
 if(label==='country')return options.find(s=>s.startsWith(value+' +'));
 if(value==='No'&&/previously been employed/.test(label))return options.find(s=>/^I have not previously been employed\b/i.test(s));
 return undefined;
}
export function sameAnswer(field,actual,expected){
 const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'');
 return norm(actual)===norm(expected)||optionForAnswer(field,String(expected),[String(actual)])===String(actual);
}
