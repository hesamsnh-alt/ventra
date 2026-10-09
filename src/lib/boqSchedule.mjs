// Planning suggestions, not UAE norms or structural release instructions.
export const TRADES = [
  ['prelim','Mobilisation / site setup',null,'item'], ['demolition','Demolition',null,'m2'], ['excavation','Excavation',null,'m3'], ['backfill','Backfill / compaction',null,'m3'],
  ['formwork','Formwork',null,'m2'], ['reinforcement','Reinforcement',null,'kg'],
  ['concrete','Pumped concrete placement',8,'m3'], ['masonry','Block / brick walls',null,'m2'],
  ['plumbing','Plumbing / drainage first fix',null,'m'], ['electrical','Electrical first fix',null,'m'], ['hvac','HVAC / ductwork',null,'m2'], ['fire','Fire protection',null,'m'], ['mep_first','Other MEP first fix',null,'m'], ['roofing','Roofing / insulation',null,'m2'], ['windows','Windows / glazing',null,'m2'], ['plaster','Wall plaster',2.8,'m2'],
  ['waterproof','Waterproofing',null,'m2'], ['screed','Screed',null,'m2'],
  ['ceiling','Gypsum / ceilings',null,'m2'], ['tiling','Tile installation',1,'m2'], ['flooring','Other flooring',null,'m2'], ['painting','Painting',null,'m2'],
  ['joinery','Joinery / doors',null,'item'], ['mep_final','MEP final fix',null,'item'],
  ['landscape','External works / landscaping',null,'m2'], ['testing','Testing / handover',null,'item'], ['custom','Other reviewed work',null,'item'],
].map(([id,label,rate,unit],order)=>({id,label,rate,unit,order:order+1}));
export const SOURCES = [
 {trade:'plaster',label:'Makerere University, Mbaine (2021): 2.8 m²/hour observed wall plastering.',url:'https://dissertations.mak.ac.ug/handle/20.500.12281/9607'},
 {trade:'concrete',label:'Petra University, Husada & Saputra (2010): pumped placement 7.69–11.72 m³/hour at the studied elevations. Proposed 8 is a rounded planning assumption.',url:'https://repository.petra.ac.id/id/eprint/4896/'},
 {trade:'tiling',label:'TELSINAS 8(1), 2025: granite tiles 7.35–8.08 m² per 8-hour day. Proposed 1 m²/hour is a rounded starting assumption; ceramic layouts may differ.',url:'https://journal.undiknas.ac.id/index.php/teknik/article/download/6156/1715'},
];
export const METHODS = {
 prelim:[{id:'site',label:'Site setup',rate:null}],
 demolition:[{id:'manual',label:'Manual / selective',rate:null},{id:'mechanical',label:'Mechanical demolition',rate:null}],
 excavation:[{id:'excavator',label:'Excavator',rate:null},{id:'manual',label:'Manual excavation',rate:null}],
 backfill:[{id:'roller',label:'Roller compaction',rate:null},{id:'plate',label:'Plate / rammer',rate:null}],
 formwork:[{id:'timber',label:'Timber formwork',rate:null},{id:'system',label:'Modular system',rate:null}],
 reinforcement:[{id:'site',label:'Site cut / bend / fix',rate:null},{id:'prefab',label:'Prefabricated cages',rate:null}],
 masonry:[{id:'block',label:'Concrete blocks',rate:null},{id:'aac',label:'AAC / thin-joint',rate:null},{id:'brick',label:'Brickwork',rate:null}],
 plumbing:[{id:'ppr',label:'PPR fusion',rate:null},{id:'pvc',label:'PVC / uPVC joints',rate:null},{id:'press',label:'Copper / press-fit',rate:null}],
 electrical:[{id:'conduit',label:'Conduit + wire',rate:null},{id:'tray',label:'Tray / trunking + cable',rate:null}],
 hvac:[{id:'duct',label:'Duct installation',rate:null},{id:'refrigerant',label:'Refrigerant piping',rate:null},{id:'equipment',label:'Equipment installation',rate:null}],
 fire:[{id:'grooved',label:'Grooved pipe',rate:null},{id:'threaded',label:'Threaded pipe',rate:null},{id:'alarm',label:'Alarm devices / wiring',rate:null}],
 roofing:[{id:'membrane',label:'Membrane / insulation',rate:null},{id:'sheet',label:'Sheet / panel roof',rate:null}],
 windows:[{id:'unit',label:'Window units',rate:null},{id:'curtain',label:'Curtain wall',rate:null}],
 waterproof:[{id:'liquid',label:'Liquid applied',rate:null},{id:'sheet',label:'Sheet membrane',rate:null}],
 screed:[{id:'hand',label:'Hand laid',rate:null},{id:'pump',label:'Pumped / flowing',rate:null}],
 ceiling:[{id:'board',label:'Board + framing',rate:null},{id:'grid',label:'Suspended grid',rate:null}],
 flooring:[{id:'vinyl',label:'Vinyl / resilient',rate:null},{id:'timber',label:'Timber / laminate',rate:null}],
 painting:[{id:'roller',label:'Brush / roller',rate:null},{id:'spray',label:'Airless spray',rate:null}],
 joinery:[{id:'site',label:'Site assembled',rate:null},{id:'prefab',label:'Factory assembled',rate:null}],
 mep_final:[{id:'devices',label:'Devices / fixtures',rate:null},{id:'equipment',label:'Equipment hook-up',rate:null}],
 landscape:[{id:'paving',label:'Paving / hardscape',rate:null},{id:'soft',label:'Planting / irrigation',rate:null}],
 testing:[{id:'systems',label:'System testing',rate:null},{id:'handover',label:'Snagging / handover',rate:null}],
 concrete:[{id:'pump',label:'Pump',rate:8,note:'Rounded case-study starting rate; complete pump crew and uninterrupted supply.'},{id:'crane',label:'Bucket / crane',rate:6.3,note:'Rounded lower case-study tower-crane rate, 6.28–7.86 m³/hour; not manual placement.'},{id:'manual',label:'Manual placement',rate:null,note:'Enter a site trial or contractor rate; transport distance, mixing and crew size must match.'}],
 plaster:[{id:'hand',label:'Hand applied',rate:2.8,note:'Observed wall-plastering study; confirm operative and helper arrangement.'},{id:'spray',label:'Machine sprayed',rate:null,note:'Enter achieved finish output, including levelling; machine discharge capacity alone is insufficient.'}],
 tiling:[{id:'standard',label:'Conventional tiles',rate:1,note:'Rounded granite study rate, subject to tile size, cuts, pattern and substrate.'},{id:'large',label:'Large-format / complex pattern',rate:null,note:'Enter measured output for the chosen tile system and lifting crew.'}],
};
export function methodsFor(trade){return [...(METHODS[trade]||[]),{id:'custom',label:'Site / contractor rate',rate:null}].map(m=>({...m,note:m.note||'Enter verified output in this BOQ unit per complete crew per productive hour; review method and crew.'}));}
export function methodDays(quantity,rate,crews,calendar){const c=validateCalendar(calendar);return Math.ceil(num(quantity,'Quantity',0.000001,1e12)/(num(rate,'Hourly output',0.000001,1e9)*num(crews,'Crews',1,100)*c.effectiveHours));}
export function unitOf(value){return String(value||'').toLowerCase().replace(/²/g,'2').replace(/³/g,'3').replace(/\s/g,'').replace(/^sqm$/,'m2').replace(/^cum$/,'m3').replace(/^(nos?\.?|pcs?|each|ea)$/,'item').replace(/^(lm|rm|m1)$/,'m');}
export function inferTrade(description){
 const s=String(description||'').toLowerCase();
 if(/demoli|strip.out|تخریب/.test(s))return 'demolition';
 if(/excavat|خاکبرداری/.test(s))return 'excavation';
 if(/formwork|shutter|قالب/.test(s))return 'formwork';
 if(/rebar|reinforc|آرماتور/.test(s))return 'reinforcement';
 if(/waterproof|عایق/.test(s))return 'waterproof';
 if(/screed/.test(s))return 'screed';
 if(/concrete|بتن/.test(s)&&!/block/.test(s))return 'concrete';
 if(/blockwork|brickwork|masonry|دیوارچینی/.test(s))return 'masonry';
 if(/plaster|گچ|اندود/.test(s)&&!/board/.test(s))return 'plaster';
 if(/tiling|tile|کاشی|سرامیک/.test(s))return 'tiling';
 if(/paint|رنگ/.test(s))return 'painting';
 if(/commission|testing|handover/.test(s))return 'testing';
 if(/final.fix|socket|switch|sanitary.fixture/.test(s))return 'mep_final';
 if(/sprinkler|fire.alarm|fire.fight/.test(s))return 'fire';
 if(/duct|hvac|air.condition|تهویه/.test(s))return 'hvac';
 if(/plumb|drain|water.pipe|لوله/.test(s))return 'plumbing';
 if(/cable|conduit|wiring|electrical|برق/.test(s))return 'electrical';
 if(/gypsum.board|ceiling|سقف کاذب/.test(s))return 'ceiling';
 if(/window|glazing|پنجره/.test(s))return 'windows';
 if(/door|joinery|cabinet|کابینت/.test(s))return 'joinery';
 if(/flooring|laminate|vinyl/.test(s))return 'flooring';
 if(/backfill|compact/.test(s))return 'backfill';
 if(/landscap|paving/.test(s))return 'landscape';
 if(/roof|insulat/.test(s))return 'roofing';
 return '';
}
export function prepareBoq(items){
 if(!Array.isArray(items)||!items.length)throw new Error('No BOQ items found. Save the BOQ for this project first.');
 if(items.length>200)throw new Error('Use a reviewed package of at most 200 BOQ activities per plan.');
 return items.map((item,i)=>{const trade=inferTrade(item.description);const p=TRADES.find(t=>t.id===trade);const unit=unitOf(item.unit);return {
 id:`boq-${i}`,sourceId:String(item.id??i),name:String(item.description||`BOQ item ${i+1}`),quantity:item.quantity,unit,
 trade,method:methodsFor(trade)[0].id,order:p?.order??16,rate:p?.unit===unit?p.rate??'':'',crews:1,
 waitDays:['concrete','plaster','waterproof','screed','tiling'].includes(trade)?'':0,
 included:true,exclusionReason:'',crewNote:trade==='concrete'?'One complete pump placement crew; ready-mix supply and access confirmed':'One trade operative with required support; confirm crew and method',
 };});
}
const DAY=86400000;
export function parseDay(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))throw new Error('Use a valid date (YYYY-MM-DD).');const n=Date.parse(`${value}T00:00:00Z`);if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==value)throw new Error('Invalid calendar date.');return n;}
export function dayString(n){return new Date(n).toISOString().slice(0,10);}
export function todayDubai(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function num(v,name,min,max){if(v===''||v===null||v===undefined||!Number.isFinite(Number(v))||Number(v)<min||Number(v)>max)throw new Error(`${name}: enter a number between ${min} and ${max}.`);return Number(v);}
export function validateCalendar(c){
 parseDay(c.start); const shift=num(c.shiftHours,'Shift hours',1,16),breaks=num(c.breakHours,'Break hours',0,15),eff=num(c.efficiency,'Efficiency',0.1,1);
 if(breaks>=shift)throw new Error('Breaks must be shorter than the shift.');
 if(!Array.isArray(c.weekdays)||!c.weekdays.length||c.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6))throw new Error('Choose working weekdays.');
 const holidays=c.holidays||[];if(!Array.isArray(holidays))throw new Error('Holidays must be dates.');holidays.forEach(parseDay);
 return {...c,shiftHours:shift,breakHours:breaks,efficiency:eff,weekdays:[...new Set(c.weekdays)],holidays:[...new Set(holidays)],effectiveHours:(shift-breaks)*eff};
}
function working(n,c){return c.weekdays.includes(new Date(n).getUTCDay())&&!c.holidays.includes(dayString(n));}
function nextWork(n,c){for(let i=0;i<3660;i++,n+=DAY)if(working(n,c))return n;throw new Error('No working day found within ten years.');}
export function generateSchedule(input,settings){
 const c=validateCalendar(settings);if(!Array.isArray(input)||!input.length||input.length>200)throw new Error('Review 1–200 BOQ items.');
 if(input.some(r=>!r.included&&!String(r.exclusionReason||'').trim()))throw new Error('Give a reason for each excluded BOQ item.');
 const active=input.filter(r=>r.included).map((r,i)=>({...r,_position:i})).sort((a,b)=>Number(a.order)-Number(b.order)||a._position-b._position);
 if(!active.length)throw new Error('Include at least one BOQ item.');
 let cursor=parseDay(c.start);const activities=[];
 for(const r of active){
  if(!TRADES.some(t=>t.id===r.trade))throw new Error(`${r.name}: select a trade.`);
  if(!String(r.name||'').trim()||!String(r.crewNote||'').trim())throw new Error('Each activity needs a description and crew/method note.');
  const quantity=num(r.quantity,r.name+' quantity',0.000001,1e12),rate=num(r.rate,r.name+' hourly rate',0.000001,1e9),crews=num(r.crews,'Crews',1,100),wait=num(r.waitDays,r.name+' calendar waiting days',0,365),order=num(r.order,'Sequence',1,999);
  if(!Number.isInteger(crews)||!Number.isInteger(wait))throw new Error('Crews and waiting days must be whole numbers.');
  if(!['m','m2','m3','kg','t','item','lot','ls','point'].includes(unitOf(r.unit)))throw new Error(`${r.name}: unsupported unit; review the BOQ.`);
  if(r.trade==='concrete'&&unitOf(r.unit)!=='m3')throw new Error(`${r.name}: concrete placement requires m³. Correct the BOQ volume; area alone is insufficient.`);
  const capacity=rate*crews*c.effectiveHours,days=Math.ceil(quantity/capacity);
  if(days>3660)throw new Error(`${r.name}: duration exceeds ten years; check quantity, unit and rate.`);
  const start=nextWork(cursor,c),workDates=[];let d=start;
  for(let k=0;k<days;k++){d=nextWork(d,c);workDates.push(dayString(d));if(k<days-1)d+=DAY;}
  if(d-parseDay(c.start)>DAY*3660)throw new Error('Plan exceeds ten years; review scope.');
  activities.push({id:r.id,name:r.name,sourceId:r.sourceId,quantity,unit:unitOf(r.unit),trade:r.trade,method:r.method||'custom',order,rate,crews,crewNote:r.crewNote,waitDays:wait,dailyCapacity:capacity,workingDays:days,start_date:dayString(start),end_date:dayString(d),workDates,predecessor:activities.at(-1)?.id??null,progress:0,progress_updated_at:null});
  cursor=d+(wait+1)*DAY;
 }
 return {version:1,calendar:c,activities,excluded:input.filter(r=>!r.included),scopeWarning:'Single workfront, finish-to-start sequence. Review construction method, missing scope, procurement, inspections and engineer-approved release/curing times. No automatic structural release.',start_date:activities[0].start_date,end_date:dayString(cursor-DAY)};
}
export function activityStatus(row,today=todayDubai()){
 const t=parseDay(today),end=parseDay(row.end_date),p=num(row.progress??0,'Progress',0,100);
 const dates=row.workDates||[];const elapsed=dates.filter(d=>parseDay(d)<t).length;
 const expected=dates.length?100*elapsed/dates.length:0;
 const overdue=p<100&&t>end;
 const state=p>=100?'complete':overdue?'overdue':p+5<expected?'behind':t<parseDay(row.start_date)?'planned':'on-track';
 return {state,expected:Math.round(expected*10)/10,lateDays:overdue?Math.floor((t-end)/DAY):0,unreported:!row.progress_updated_at};
}
export function planProgress(plan){
 const rows=plan?.activities||[];let total=0,done=0;
 for(const r of rows){const w=Number(r.quantity)/Number(r.rate);if(Number.isFinite(w)&&w>0){total+=w;done+=w*Math.max(0,Math.min(100,Number(r.progress)||0))/100;}}
 return {percent:total?Math.round(done/total*1000)/10:0,completed:rows.filter(r=>Number(r.progress)>=100).length,total:rows.length,excluded:plan?.excluded?.length||0};
}
