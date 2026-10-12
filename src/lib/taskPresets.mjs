import {translateText} from './i18n/translate.mjs';
export const TASK_ROLES=[
 ['project-manager','Project manager'],['site-manager','Site manager'],['site-supervisor','Site supervisor'],['civil-engineer','Civil engineer'],['structural-engineer','Structural engineer'],['architect','Architect'],['mep-engineer','MEP engineer'],['mechanical-engineer','Mechanical engineer'],['electrical-engineer','Electrical engineer'],['qa-engineer','Quality engineer'],['safety-officer','Safety officer'],['surveyor','Surveyor'],['foreman','Foreman'],['procurement','Procurement officer'],['quantity-surveyor','Quantity surveyor'],
].map(([id,label])=>({id,label}));
export const TASK_GROUPS=['Site preparation','Structure','Services','Finishes','Management and handover'];
export const TASK_PRESETS=[
 ['setup','Site preparation','Arrange site mobilisation and temporary facilities','site-manager','Medium'],
 ['survey','Site preparation','Check setting-out and site levels','surveyor','High'],
 ['utilities','Site preparation','Check existing underground utilities before excavation','civil-engineer','High'],
 ['excavation','Site preparation','Coordinate excavation access, equipment and spoil removal','site-supervisor','High'],
 ['excavation-safety','Site preparation','Inspect excavation access and safety measures','safety-officer','High'],
 ['foundation','Structure','Review foundation setting-out against approved drawings','structural-engineer','High'],
 ['rebar','Structure','Inspect reinforcement before concrete placement','structural-engineer','High'],
 ['formwork','Structure','Inspect formwork and supports before concrete placement','civil-engineer','High'],
 ['concrete','Structure','Coordinate concrete delivery, testing and placement','site-manager','High'],
 ['curing','Structure','Record concrete curing and inspection follow-up','qa-engineer','High'],
 ['frame','Structure','Check structural frame against approved drawings','structural-engineer','High'],
 ['masonry','Structure','Check wall positions and door/window openings','civil-engineer','Medium'],
 ['plumbing','Services','Inspect plumbing and drainage before concealment','mep-engineer','High'],
 ['electrical','Services','Inspect conduits and electrical routes before concealment','electrical-engineer','High'],
 ['hvac','Services','Check HVAC equipment positions and duct routes','mechanical-engineer','Medium'],
 ['coordination','Services','Review coordination between structural and MEP works','mep-engineer','High'],
 ['waterproof','Finishes','Inspect wet-area waterproofing and record test results','qa-engineer','High'],
 ['finishes','Finishes','Check tile, flooring and wall-finish samples','architect','Medium'],
 ['doors','Finishes','Inspect installation of doors and windows','architect','Medium'],
 ['daily','Management and handover','Prepare daily labour, equipment and progress report','site-supervisor','Medium'],
 ['materials','Management and handover','Confirm material availability for upcoming activities','procurement','High'],
 ['quantities','Management and handover','Review completed quantities against the BOQ','quantity-surveyor','Medium'],
 ['snags','Management and handover','Record defects and follow up corrective work','qa-engineer','Medium'],
 ['handover','Management and handover','Collect inspection records and handover documents','project-manager','Medium'],
].map(([id,group,title,role,priority])=>({id,group,title,role,priority}));
export function taskPresetDraft(id,language='en'){
 const preset=TASK_PRESETS.find(p=>p.id===id);if(!preset)return null;
 const role=TASK_ROLES.find(r=>r.id===preset.role);
 return {title:translateText(preset.title,language),assignee:translateText(role.label,language),priority:preset.priority};
}
