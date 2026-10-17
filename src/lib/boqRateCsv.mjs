// Pure local CSV parsing. Rate rows never supply drawing quantities.
export function parseCsv(text){
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  text=String(text).replace(/^\uFEFF/,'');
  if(text.length>4*1024*1024)throw Error('CSV exceeds 4 MiB.');
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
    if(c==='"'){if(cell||closed)throw Error('Invalid CSV quote.');quoted=true;continue;}
    if(c===','||c==='\n'||c==='\r'){
      row.push(cell);cell='';closed=false;
      if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v.trim()))rows.push(row);row=[];}
    }else{if(closed)throw Error('Unexpected text after a CSV quote.');cell+=c;}
  }
  if(quoted)throw Error('Unclosed CSV quote.');
  if(cell||closed||row.length){row.push(cell);if(row.some(v=>v.trim()))rows.push(row);}
  if(rows.length<2||rows.length>10001)throw Error('CSV requires headers and 1–10000 rows.');
  const headers=rows.shift().map(s=>s.trim());
  if(new Set(headers).size!==headers.length)throw Error('Duplicate CSV header.');
  return rows.map(r=>{if(r.length!==headers.length)throw Error('CSV row/header column count mismatch.');return Object.fromEntries(headers.map((h,i)=>[h,r[i]]));});
}

export function rateCatalogFromCsv(text){
  const seen=new Set();
  return parseCsv(text).map((row,i)=>{
    if(Object.keys(row).some(k=>!['code','description_en','unit','rate_aed'].includes(k)))throw Error('Use a rate-only CSV with code, description_en, unit, rate_aed. Quantity/answer files are not rate inputs.');
    for(const key of ['code','description_en','unit','rate_aed'])if(!String(row[key]??'').trim())throw Error(`Rate CSV row ${i+2}: ${key} required.`);
    const code=row.code.trim().toUpperCase();if(seen.has(code))throw Error(`Duplicate rate code: ${code}`);seen.add(code);
    if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(row.rate_aed.trim()))throw Error(`Invalid rate for ${code}.`);
    const rate=Number(row.rate_aed);if(!Number.isFinite(rate)||rate>1e12)throw Error(`Invalid rate for ${code}.`);
    return {item_code:code,description:row.description_en.trim(),unit:row.unit.trim(),standard_rate:rate,
      section_code:'PROJECT-CSV',source_name:'User-supplied project CSV',is_active:true};
  });
}

