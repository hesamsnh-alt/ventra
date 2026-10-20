// BOQ selection is a deterministic projection over saved evidence. No I/O or model calls.
export const BOQ_TRADES = ['earthworks','structure','masonry','finishes','openings','plumbing','hvac','electrical','furniture','roofing','demolition','metalwork','external'];
export const BOQ_PRESETS = {
 full: BOQ_TRADES.filter(x=>x!=='demolition'),
 fitout: ['finishes','openings','plumbing','hvac','electrical','furniture'],
 renovation: ['demolition','masonry','finishes','openings','plumbing','hvac','electrical','furniture'],
};
const number = x => Number.isFinite(Number(x)) && Number(x)>0 ? Number(x) : 0;
const round = x => Math.round(x*10000)/10000;
export function normalizeBoqScope(value={}) {
 const preset=Object.hasOwn(BOQ_PRESETS,value.preset)?value.preset:'full';
 const trades=Array.isArray(value.trades)?[...new Set(value.trades.filter(x=>BOQ_TRADES.includes(x)))]:[...BOQ_PRESETS[preset]];
 return {version:170,enabled:value.enabled===true,preset,trades,onlyDrawingDiscipline:value.onlyDrawingDiscipline===true,
 discipline:['architecture','structure','plumbing','hvac','electrical','roofing','mixed','unknown'].includes(value.discipline)?value.discipline:'unknown',
 defaultsEnabled:value.defaultsEnabled!==false,wallHeight:Math.min(8,Math.max(2,number(value.wallHeight)||3)),
 lightsPerRoom:Math.min(20,Math.max(1,Math.round(number(value.lightsPerRoom)||1))),
 waterproofUpstand:Math.min(1,Math.max(0,Number.isFinite(Number(value.waterproofUpstand))?Number(value.waterproofUpstand):.15)),
 cabinetLength:Math.min(30,Math.max(0,Number.isFinite(Number(value.cabinetLength))?Number(value.cabinetLength):3)),
 floorFinish:['ceramic','porcelain','stone','wood','cement'].includes(value.floorFinish)?value.floorFinish:'ceramic',
 ceilingFinish:['paint','gypsum','none'].includes(value.ceilingFinish)?value.ceilingFinish:'paint',
 screedEnabled:value.screedEnabled!==false,
 wallFinish:['paint','plaster','tile','none'].includes(value.wallFinish)?value.wallFinish:'paint',
 specifications:String(value.specifications||'').slice(0,4000)};
}
export function detectDrawingDiscipline(takeoff={},fileName='') {
 const pages=takeoff.page_results||[];
 const text=[fileName,takeoff.discipline,takeoff.document_name,...pages.flatMap(p=>[p.page_evidence?.kind,p.page_evidence?.title,p.page_evidence?.discipline,p.drawing_type,p.notes,...(p.native_plan_text?.spans||[]).slice(0,300).map(s=>s.text)])].filter(Boolean).join(' ').toLowerCase();
 const patterns={structure:/structural|beam layout|framing plan|reinforcement|rebar|foundation plan|تیرریزی|سازه|آرماتور/g,
 plumbing:/plumbing|drainage|water supply|sanitary layout|لوله.?کشی|آبرسانی|فاضلاب/g,
 hvac:/\bhvac\b|mechanical plan|duct layout|air conditioning|تهویه|کانال.?کشی/g,
 electrical:/electrical|lighting plan|power layout|single.line diagram|برق|روشنایی/g,
 roofing:/roof drainage|roof slope|slope plan|شیب.?بندی|پلان بام/g,
 architecture:/architectural|floor.plan|ground floor plan|first floor plan|پلان معماری/g};
 const scores=Object.entries(patterns).map(([id,re])=>({id,score:(text.match(re)||[]).length})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
 const substantive=scores.filter(x=>x.id!=='architecture');
 const discipline=substantive.length>1?'mixed':substantive[0]?.id||scores[0]?.id||'unknown';
 return {discipline,signals:scores,requiresConfirmation:true,basis:'Saved page titles, text and labels; suggestion only, editable before applying scope.'};
}
export function boqItemTrade(item={}) {
 if(BOQ_TRADES.includes(item.boqTrade))return item.boqTrade;
 const key=String(item.pdfEvidence?.metricKey||item.scopeDefault?.metric||'').toLowerCase();
 // Semantic extraction keys take precedence over incidental material words.
 const keyTrades=[['metalwork',/^(terrace_railing|handrail|guardrail)_/],['external',/^(landscape|driveway|external_paving)_/],['earthworks',/^(excavation|backfill)/],['roofing',/^(roof_waterproofing|roof_slope)/],['structure',/^(pcc|foundation|pedestal|column|beam|ground_slab|first_slab|roof_slab|slab_formwork|rebar)_/],['masonry',/^(internal_block|external_block)_/],['openings',/^(door|internal_door|entrance_door|service_door|garage_door|window)_/],['hvac',/^(ac_|duct_|fcu_|chilled_water)/],['electrical',/^(light|socket|switch|distribution_board|smoke_detector|cable|conduit)_/],['plumbing',/^(water_pipe|waste_pipe|toilet|basin|shower|kitchen_sink|laundry_sink|kitchen_tap|floor_drain)_/],['furniture',/^(kitchen_cabinet|furniture)_/],['finishes',/^(floor_area|ceiling_area|plaster_area|paint_area|ceiling_paint|gypsum_ceiling|wet_|ceramic_floor|wood_floor|stone_floor|cement_floor|epoxy_floor|terrace_floor|screed|skirting|unallocated_floor)/]];
 for(const [trade,pattern] of keyTrades)if(pattern.test(key))return trade;
 const family=item.pdfEvidence?.operation?.family||'';
 const text=[key,family,item.section,item.category,item.description].join(' ').toLowerCase();
 if(/railing|handrail|guardrail|balustrad|metal works|metalwork|نرده|فلزکاری/.test(text))return 'metalwork';
 if(/landscap|grass|planting|driveway|external paving|external works|محوطه|فضای سبز|چمن/.test(text))return 'external';
 if(/demolit|strip.?out|removal|تخریب|نخاله/.test(text))return 'demolition';
 if(/excavat|backfill|earthwork|خاکبرداری/.test(text))return 'earthworks';
 if(/roof.*(?:waterproof|slope|screed)|roofing|شیب.?بندی|عایق بام/.test(text))return 'roofing';
 if(/concrete|foundation|formwork|rebar|reinforc|structural steel|beam_volume|column_volume|slab_volume|فونداسیون|میلگرد/.test(text))return 'structure';
 if(/block_area|masonry|block wall|brickwork|دیوارچینی/.test(text))return 'masonry';
 if(/door|window|fixed.glaz|درب|پنجره/.test(text))return 'openings';
 if(/ac_pipe|ac_count|fan.coil|duct|hvac|air.condition|chilled.water|تهویه|فن.?کویل/.test(text))return 'hvac';
 if(/electrical|light_count|socket|smoke_detector|distribution_board|cable|conduit|led.light|switch|روشنایی|برق/.test(text))return 'electrical';
 if(/water_pipe|waste_pipe|plumb|toilet|basin|shower|sink|sanitary|floor.drain|water.heater|tap|faucet|لوله|روشویی|توالت|شیرآلات/.test(text))return 'plumbing';
 if(/furnitur|cabinet|carpentry|joinery|wardrobe|کابینت|مبلمان/.test(text))return 'furniture';
 if(/finish|floor|skirting|plaster|paint|ceiling|waterproof|tile|screed|render|گچ|پلاستر|سرامیک|رنگ/.test(text))return 'finishes';
 return 'unclassified';
}
export function activeBoqTrades(config) {
 const c=normalizeBoqScope(config);
 if(!c.onlyDrawingDiscipline){if(c.enabled&&!c.trades.length)throw new Error('Select at least one BOQ trade.');return c.trades;}
 if(c.discipline==='architecture')return c.trades.filter(t=>['masonry','finishes','openings','furniture'].includes(t));
 if(['structure','plumbing','hvac','electrical','roofing'].includes(c.discipline))return [c.discipline];
 throw Object.assign(new Error('Confirm one drawing discipline before selecting “only this discipline”.'),{code:'BOQ_DISCIPLINE_REQUIRED'});
}
export function scopeMetric(item={}) {
 const key=item.scopeDefault?.metric||item.pdfEvidence?.metricKey||'';
 const op=item.pdfEvidence?.operation, text=String(op?.sourceDescription||item.description||'').toLowerCase();
 if(op?.family==='floor')return /wood|lvt|spc|parquet/.test(text)?'wood_floor_area':/stone|marble|granite|terrazzo/.test(text)?'stone_floor_area':/epoxy|resin/.test(text)?'epoxy_floor_area':/ceramic|porcelain|tile/.test(text)?'ceramic_floor_area':key;
 if(op?.family==='door-set')return 'door_count';
 if(op?.family==='window-set')return 'window_count';
 if(/wash basin|washbasin/.test(text))return 'basin_count';
 if(/toilet pan|water closet/.test(text))return 'toilet_count';
 if(/shower/.test(text)&&op?.family==='fixture')return 'shower_count';
 if(/sink/.test(text)&&op?.family==='fixture')return 'kitchen_sink_count';
 if(/led light|lighting point/.test(text)&&op?.family?.startsWith('electrical'))return 'light_count';
 return key;
}
const aliases={light_count:['lighting_points'],basin_count:['wash_basin_count'],ceramic_floor_area:['floor_tiles_area'],plaster_area:['internal_plaster_area']};
function metricTotal(items,key){return items.filter(i=>[key,...(aliases[key]||[])].includes(scopeMetric(i))).reduce((s,i)=>s+number(i.quantity),0);}
export function measuredRooms(takeoff={}) {
 const floors=new Map();
 for(const p of takeoff.page_results||[]){
  if(p.page_evidence?.kind!=='floor_plan')continue;
  const floor=p.page_evidence?.scope_id;if(!floor||floor==='project')continue;
  const rooms=[],seenTags=new Set();
  for(const [index,r] of (p.detected_items||[]).entries()){
   const name=String(r.name||'').trim(),description=String(r.description||'');
   if(!['m2','m²'].includes(String(r.unit).toLowerCase())||!number(r.quantity)||/\b(total|subtotal|aggregate|void|outdoor|terrace|balcony)\b|جمع کل|بالکن|تراس/i.test(name+' '+description))continue;
   if(!name||/floor area|tile area|wall area|plaster area|total area/i.test(name))continue;
   const tag=r.tag||name.match(/^([A-Z]{1,4}[-_]?\d{1,4})(?=\s|$)/i)?.[1];
   if(tag&&seenTags.has(tag))continue;if(tag)seenTags.add(tag);
   const sanitary=/toilet|bath|ensuite|restroom|\bwc\b|حمام|سرویس|توالت/i.test(name),kitchen=/kitchen|pantry|آشپزخانه|آبدارخانه/i.test(name);
   rooms.push({id:floor+':'+(tag||r.id||'room-'+index),name,area:number(r.quantity),floor,page:p.pageNumber,sanitary,kitchen,bath:/bath|ensuite|حمام/i.test(name),perimeter:number(r.perimeter_m||r.perimeter)});
  }
  // Repeated sheets of one floor are alternatives, not additional rooms.
  if(rooms.length>(floors.get(floor)?.length||0))floors.set(floor,rooms);
 }
 return [...floors.values()].flat();
}
function defaultOperations(items,takeoff,c,active) {
 const added=[],rooms=measuredRooms(takeoff),wet=rooms.filter(r=>r.sanitary),kitchens=rooms.filter(r=>r.kitchen);
 const quantity=key=>metricTotal([...items,...added],key);
 const add=(metric,trade,value,unit,description,basis)=>{
  if(!active.includes(trade)||!number(value)||quantity(metric)>0)return;
  added.push({id:'scope-default:'+metric+(/floor_finish|floor_area/.test(metric)?':'+c.floorFinish:''),itemCode:'SCOPE-'+metric.toUpperCase(),boqTrade:trade,description,section:trade,unit,quantity:round(value),rate:0,amount:0,
   source:'Editable BOQ scope assumption',status:'measured_rate_pending',verification:'pending',reviewRequired:true,includeInCommercialTotal:false,quantityLocked:false,rateMissing:true,
   quantityBasis:basis,rateSource:'Select an existing project/catalog rate or enter a rate',notes:'ASSUMED QUANTITY / EDITABLE: '+basis+'. Not measured from an engineering design.',
   scopeDefault:{metric,version:170,basis,initialQuantity:round(value),initialDescription:description},completion:{code:'scope_assumption_rate_required',required_information:['Confirm quantity/specification and select a matching rate.']}});
 };
 const floor=quantity('floor_area')||number(takeoff.floor_area)||rooms.reduce((s,r)=>s+r.area,0);
 const floorMetrics=['ceramic_floor_area','wood_floor_area','epoxy_floor_area','stone_floor_area','cement_floor_area','terrace_floor_area'];
 const finished=items.filter(i=>floorMetrics.includes(scopeMetric(i))||i.pdfEvidence?.operation?.family==='floor').reduce((s,i)=>s+number(i.quantity),0);
 const unallocated=Math.max(0,floor-finished);
 const floorKey={ceramic:'ceramic_floor_area',porcelain:'ceramic_floor_area',stone:'stone_floor_area',wood:'wood_floor_area',cement:'cement_floor_area'}[c.floorFinish];
 // Do not overwrite a partially assigned finish. Unallocated areas become a distinct assumption.
 if(unallocated>0&&active.includes('finishes')){
  if(!quantity(floorKey))add(floorKey,'finishes',unallocated,'m²',`${c.floorFinish} floor finish including laying and joints [assumed]`,`${unallocated} m² of recorded floor not allocated to a positive finish row; ${c.floorFinish} is the editable default`);
  else add('unallocated_floor_finish_area','finishes',unallocated,'m²',`${c.floorFinish} floor finish for unallocated area [assumed]`,`${floor} m² recorded floor minus ${finished} m² assigned finishes; no replacement of known finishes`);
 }
 // Plaster / paint derive only from an existing wall surface or a known wall length plus disclosed height.
 const wallSurface=quantity('plaster_area')||quantity('paint_area')||number(takeoff.wall_area)||number(takeoff.wall_length)*c.wallHeight;
 if(c.wallFinish!=='none'){
  add('plaster_area','finishes',wallSurface,'m²','Internal wall plaster [assumed]',`Recorded wall surface, or recorded wall length × editable height ${c.wallHeight} m; sides and deductions require review`);
  if(c.wallFinish==='paint')add('paint_area','finishes',Math.max(0,wallSurface-quantity('wet_wall_tile_area')),'m²','Internal wall paint [assumed]','Recorded plaster/wall surface less known wet wall tile area');
  if(c.wallFinish==='tile')add('wet_wall_tile_area','finishes',wallSurface,'m²','Wall tiles [assumed]','Recorded wall surface; selected default wall finish');
 }
 const ceiling=quantity('ceiling_area')||number(takeoff.ceiling_area);
 if(c.ceilingFinish!=='none'){
  if(c.ceilingFinish==='gypsum')add('gypsum_ceiling_area','finishes',ceiling,'m²','Gypsum board ceiling [assumed]','Recorded enclosed ceiling area; board, suspension and wet-area specifications require confirmation');
  add('ceiling_paint_area','finishes',ceiling,'m²','Ceiling paint [assumed]','Recorded enclosed ceiling area; finish compatibility to confirm');
 }
 if(c.screedEnabled&&!items.some(i=>number(i.quantity)>0&&(/screed|levelling|leveling/i.test(i.description)||i.pdfEvidence?.operation?.family==='screed')))add('screed_area','finishes',floor,'m²','Floor levelling screed 50 mm [assumed]','Recorded floor area; assumed 50 mm levelling layer, separate from finish laying; confirm whether included in the floor package');
 if(active.includes('roofing'))add('roof_waterproofing_area','roofing',number(takeoff.roof_area),'m²','Roof waterproofing [assumed]','Recorded roof area; system and upstands require project confirmation');
 const wetArea=wet.reduce((s,r)=>s+r.area,0);
 add('wet_floor_waterproofing_area','finishes',wetArea,'m²','Wet room floor waterproofing [assumed]',`Sum of labelled sanitary room areas (${wet.map(r=>r.name).join(', ')}); extent to confirm`);
 const wetPerimeter=wet.filter(r=>r.perimeter>0).reduce((s,r)=>s+r.perimeter,0);
 add('wet_wall_waterproofing_area','finishes',wetPerimeter*c.waterproofUpstand,'m²','Wet room waterproofing upstand [assumed]',`Recorded wet room perimeters × editable ${c.waterproofUpstand} m upstand; no invented perimeter`);
 add('toilet_count','plumbing',wet.length,'nos','WC set [assumed]','One WC set per labelled sanitary room; layout, accessible and communal provision require confirmation');
 add('basin_count','plumbing',wet.length,'nos','Wash basin set [assumed]','One basin per labelled sanitary room; confirm the actual arrangement');
 add('basin_tap_count','plumbing',added.some(i=>scopeMetric(i)==='basin_count')?wet.length:0,'nos','Basin mixer [assumed; separate only if not included in basin rate]','One mixer per assumed basin; check package inclusions before assigning rate');
 add('shower_count','plumbing',wet.filter(r=>r.bath).length,'nos','Shower set [assumed]','One shower per room explicitly labelled bathroom or ensuite; WC-only rooms excluded');
 add('kitchen_sink_count','plumbing',kitchens.length,'nos','Kitchen sink set [assumed]','One sink per labelled kitchen/pantry; includes no assumed second bowl or draining sink');
 add('kitchen_tap_count','plumbing',added.some(i=>scopeMetric(i)==='kitchen_sink_count')?kitchens.length:0,'nos','Kitchen mixer [assumed; separate only if not included in sink rate]','One mixer per assumed sink; check package inclusions before assigning rate');
 add('kitchen_cabinet_length','furniture',kitchens.length*c.cabinetLength,'m','Kitchen base cabinets [assumed] ',`${kitchens.length} labelled kitchens × editable allowance ${c.cabinetLength} m; not a measured cabinet run`);
 add('light_count','electrical',rooms.length*c.lightsPerRoom,'nos','Lighting point allowance [assumed; not a lighting design]',`${rooms.length} labelled enclosed rooms × editable ${c.lightsPerRoom} points; routes, lux levels and fittings are not designed`);
 return added;
}
const docs={metalwork:'Dimensioned railing/metalwork details, heights, lengths and specifications',external:'Landscape/external works plan with areas, levels and finish specifications',earthworks:'Site levels, excavation extents/depths and foundation layout',structure:'Structural plans, member sections and reinforcement/steel details',masonry:'Dimensioned wall plan, thicknesses, heights and openings',finishes:'Dimensioned room/wall areas, heights and finish specifications',openings:'Readable door/window symbols, dimensions and opening schedule',plumbing:'Plumbing layout, routes, diameters, fixtures and connection details',hvac:'HVAC layout, duct/pipe sizes, routes and equipment capacities',electrical:'Electrical layouts, cable/conduit routes, sizes and circuit schedules',furniture:'Dimensioned cabinet/joinery/furniture layout and specifications',roofing:'Roof levels, falls, drains, layer thicknesses and waterproofing details',demolition:'Existing/proposed drawings or a marked demolition/retention scope'};
export function applyBoqScope(items=[],takeoff={},config={},options={}) {
 const c=normalizeBoqScope(config);
 if(!c.enabled)return {items:items.map(i=>{if(!i.scopeDisclosure&&!i.scopeExclusion)return i;const {scopeDisclosure,scopeExclusion,...rest}=i;return rest;}),report:null,excluded:[],config:c};
 const active=activeBoqTrades(c),excluded=[],selected=[];
 for(const original of items){
  const {scopeDisclosure,scopeExclusion,...item}=original;
  const trade=boqItemTrade(item);
  if(active.includes(trade))selected.push(item);else excluded.push({...item,scopeExclusion:trade==='unclassified'?'classification_required':'outside_selected_scope'});
 }
 const defaults=c.defaultsEnabled?defaultOperations(selected,takeoff,c,active).filter(i=>!options.defaultEdits?.[i.id]?.disabled):[];
 const merged=[...selected,...defaults];
 // Rates for assumptions are explicit user choices only. Never borrow an unrelated positive rate.
 for(let i=0;i<merged.length;i++){
  const row=merged[i],edit=options.defaultEdits?.[row.id];
  if(!row.scopeDefault||!edit)continue;
  const q=Number(edit.quantity),r=Number(edit.rate);
  merged[i]={...row,quantity:Number.isFinite(q)&&q>=0?q:row.quantity,rate:Number.isFinite(r)&&r>=0?r:row.rate,
   description:typeof edit.description==='string'?edit.description.slice(0,1000):row.description};
  const next=merged[i];next.amount=round(next.quantity*next.rate);next.rateMissing=!(next.rate>0);next.status=next.rate>0?'provisional_estimate':'measured_rate_pending';next.verification=next.rate>0?'provisional':'pending';next.notes+=' User edits retained; assumed quantities remain provisional.';
 }
 const gaps=[];
 for(const trade of active){
  const measured=selected.filter(i=>boqItemTrade(i)===trade&&number(i.quantity)&&!i.scopeDefault);
  const assumed=defaults.filter(i=>boqItemTrade(i)===trade);
  // Even some measured items do not establish completeness of a discipline.
  if(!measured.length||['structure','earthworks','plumbing','hvac','electrical','roofing','demolition'].includes(trade))gaps.push({trade,status:measured.length?'coverage_review_required':assumed.length?'assumed_only':'not_measured',required:docs[trade],action:'Upload supporting drawings or enter measured quantities manually; missing quantities are not included in the current total.'});
 }
 if(excluded.some(i=>i.scopeExclusion==='classification_required'&&number(i.quantity)))gaps.push({trade:'unclassified',status:'classification_required',required:'Classify retained unrecognised BOQ rows before inclusion',action:'Rows are preserved outside the selected BOQ until their trade is assigned.'});
 const report={version:170,preset:c.preset,activeTrades:active,onlyDrawingDiscipline:c.onlyDrawingDiscipline,discipline:c.discipline,gaps,
  assumedRows:merged.filter(i=>i.scopeDefault).length,excludedRows:excluded.length,specifications:c.specifications,
  note:'Scope-selected BOQ. Assumed quantities/specifications are editable estimates. Unmeasured or unpriced work is excluded from the total; a displayed total is not proof of complete project coverage.'};
 return {items:merged.map((i,index)=>({...i,itemNumber:String(index+1).padStart(2,'0'),...(index===0?{scopeDisclosure:report}:{})})),report,excluded,config:c};
}
