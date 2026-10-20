// Whole-crew productive-hour planning allowances. No prices, AI calls or DB changes.
// Source coefficients are installation-only; all other entries are Ventra allowances.
const manual='https://www.marines.mil/portals/1/Publications/MCRP%203-40D.12.pdf';
export const PRODUCTIVITY_SOURCES=[
 {id:'manual',url:manual,label:'US military construction estimating manual (2021), installation labour coefficients; not UAE norms.'},
 {id:'cat',url:'https://www.cat.com/en_US/articles/for-owners/how-to-calculate-cat-wheel-loader-productivity.html',label:'Caterpillar: machine output depends on payload, cycle, travel and job conditions; no universal excavation rate.'}
];
// [unit, output per complete crew per productive hour, skilled people, helpers]
const DATA={
 prelim:{site:['ls',1/16,1,2]}, demolition:{manual:['m2',2,1,2],mechanical:['m2',12,1,2]},
 excavation:{excavator:['m3',69.12,1,1],manual:['m3',0.5,2,2]},backfill:{roller:['m3',25,2,2],plate:['m3',5,1,2]},
 formwork:{timber:['m2',2,2,1],system:['m2',4,2,1]},reinforcement:{site:['kg',60,2,2],prefab:['kg',120,2,2]},
 concrete:{pump:['m3',8,3,3],crane:['m3',6.3,3,3],manual:['m3',1.5,2,4]},
 masonry:{block:['m2',2,1,1],aac:['m2',3,1,1],brick:['m2',1,1,1]},
 plumbing:{ppr:['m',3,1,1],pvc:['m',2*0.3048/0.36,1,1],press:['m',4,1,1]},
 electrical:{conduit:['m',4,1,1],tray:['m',5,1,1]},
 hvac:{duct:['m2',3,2,1],refrigerant:['m',2.5,1,1],equipment:['item',0.25,2,1]},
 fire:{grooved:['m',3,2,1],threaded:['m',1.5,2,1],alarm:['point',1,1,1]},
 mep_first:{custom:['m',2,1,1]},roofing:{membrane:['m2',5,2,1],sheet:['m2',6,2,1]},
 windows:{unit:['m2',2,2,1],curtain:['m2',1,2,2]},
 plaster:{hand:['m2',2.8,1,1],spray:['m2',8,2,1]},
 waterproof:{liquid:['m2',2*0.09290304/0.043,1,1],sheet:['m2',2*0.09290304/0.039,1,1]},
 screed:{hand:['m2',4,2,1],pump:['m2',12,2,2]},ceiling:{board:['m2',3,2,1],grid:['m2',5,2,1]},
 tiling:{standard:['m2',1,1,1],large:['m2',0.6,2,1]},flooring:{vinyl:['m2',5,1,1],timber:['m2',3,1,1]},
 painting:{roller:['m2',5,1,1],spray:['m2',12,1,1]},joinery:{site:['item',0.25,2,0],prefab:['item',0.5,2,0]},
 mep_final:{devices:['item',1,1,1],equipment:['item',0.25,2,1]},
 landscape:{paving:['m2',3,2,1],soft:['m2',5,1,2]},testing:{systems:['ls',1/16,2,0],handover:['ls',1/8,1,1]}
};
const waits={concrete:7,plaster:3,waterproof:2,screed:7,tiling:1};
export function productivityFor(trade,method,unit,name=''){
 let d=DATA[trade]?.[method]; let source=null,detail='';
 if(method==='custom'&&trade!=='mep_first')return null;
 if(trade==='joinery'&&unit==='m'){
  d=['m',method==='prefab'?2*0.3048/0.851:0.45,2,0];
  if(method==='prefab'){source=manual;detail='Stock cabinets installation only; 0.851 man-hours/linear foot, two installers; excludes countertop and manufacture.';}
 }
 if(trade==='joinery'&&unit==='m2')d=['m2',method==='prefab'?1.5:0.8,2,0];
 if(trade==='plumbing'&&method==='pvc'){source=manual;detail='50 mm PVC with couplings/supports: 0.360 man-hours/linear foot, utilities worker + helper. Fittings/testing separately.';}
 if(trade==='waterproof'){source=manual;detail=method==='liquid'?'Two-coat cementitious slurry, 0.043 man-hours/sq ft, two workers.':'Elastomeric sheet, 0.039 man-hours/sq ft, two workers.';}
 if(trade==='excavation'&&method==='excavator')detail='Assumed 0.8 m³ bucket × 0.90 fill × 120 cycles/hour ÷ 1.25 swell = 69.12 bank m³/hour. Ordinary accessible soil; excludes haul/disposal, rock, shoring and dewatering. Not a Cat published rate.';
 if(trade==='hvac'&&unit==='item'&&method!=='equipment')return null;
 if(!d)return null;
 let [u,rate,skilled,helpers]=d;
 if(u==='kg'&&unit==='t'){u='t';rate/=1000;}
 if(['ls','lot','item'].includes(unit)&&u==='ls')u=unit;
 if(unit==='point'&&u==='item'&&trade==='mep_final')u=unit;
 if(unit==='item'&&u==='point'&&trade==='fire')u=unit;
 if(u!==unit)return null;
 return {rate,crewNote:`${skilled} skilled / operator + ${helpers} helpers`,waitDays:waits[trade]||0,source,detail,basis:source?'source-coefficient':'planning-allowance'};
}
export function selectDefaultMethod(trade,unit,name,first){
 const s=String(name||'').toLowerCase();
 if(trade==='hvac')return unit==='item'?'equipment':unit==='m'?'refrigerant':'duct';
 if(trade==='plumbing'&&/pvc|upvc|drain|صرف|فاضلاب/.test(s))return 'pvc';
 if(trade==='joinery'&&/cabinet|کابینت|خزان/.test(s))return 'prefab';
 if(trade==='mep_final'&&/fan.coil|equipment|pump|فن.?کویل|پمپ/.test(s))return 'equipment';
 if(trade==='fire'&&(/alarm|اعلان/.test(s)||unit==='point'))return 'alarm';
 return first;
}
export function scheduleTotals(plan){
 if(!plan?.activities?.length)return null;
 const workingDays=plan.activities.reduce((n,r)=>n+Number(r.workingDays||0),0);
 const waitingDays=plan.activities.reduce((n,r)=>n+Number(r.waitDays||0),0);
 return {workingDays,waitingDays,calendarDays:Math.round((Date.parse(plan.end_date)-Date.parse(plan.start_date))/86400000)+1};
}
