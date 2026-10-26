export function normalizeSuggestions(value){
  if(!Array.isArray(value))return [];
  const seen=new Set();
  return value.flatMap(item=>{
    if(typeof item?.label!=='string'||typeof item?.prompt!=='string')return [];
    const label=item.label.trim(),prompt=item.prompt.trim();
    if(!label||label.length>60||!prompt||prompt.length>600||seen.has(prompt.toLowerCase()))return [];
    seen.add(prompt.toLowerCase());return [{label,prompt}];
  }).slice(0,3);
}
