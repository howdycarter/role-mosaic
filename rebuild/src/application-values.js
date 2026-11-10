export function optionForAnswer(field,answer,options){
 const value=String(answer),label=field.label.replace(/[*:]/g,'').trim().toLowerCase();
 const exact=options.find(s=>s.toLowerCase()===value.toLowerCase());if(exact)return exact;
 const us=s=>/^(united states(?: of america)?|usa|us)$/i.test(String(s).replace(/\s*\+\d+\s*$/,'').trim());
 if(/\bcountry\b/i.test(label)&&us(value))return options.find(us);
 if(field.locationKnown){
  const expected=field.locationKnown,norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  return options.find(option=>{const parts=option.split(',').map(norm);return parts.length>=2&&parts[0]===norm(expected.city)&&[norm(expected.state),norm(expected.stateCode)].includes(parts[1])&&(!parts[2]?field.countryContext==='US':/^(united states(?: of america)?|us|usa)$/.test(parts[2])&&expected.country==='United States');});
 }
 if(label==='country')return options.find(s=>s.startsWith(value+' +'));
 if(value==='No'&&/previously been employed/.test(label))return options.find(s=>/^I have not previously been employed\b/i.test(s));
 if(value==='No'&&/ever been employed/.test(label))return options.find(s=>/^No, I have never worked at\b/i.test(s));
 return undefined;
}
export function sameAnswer(field,actual,expected){
 const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]+/g,'');
 return norm(actual)===norm(expected)||optionForAnswer(field,String(expected),[String(actual)])===String(actual);
}
