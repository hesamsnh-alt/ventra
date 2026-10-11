import {applyPromptActions,promptActionSchema,promptSceneContext} from './scenePromptActions.mjs';

export const SCENE_PROMPT_INSTRUCTIONS=`You control Ventra's editable schematic 3D interior, NOT an image generator.
Understand English, Persian and Arabic, informal phrasing and spelling mistakes (e.g. "washing machin in kitchen"). Reply in the user's language.
Convert the COMPLETE user request to a small batch of furniture and palette actions. Never silently ignore a requested part. If any requested feature is unsupported or unclear, return unsupported/clarify and zero actions, explaining why. Never promise a change you cannot represent.
Architecture is immutable: no changing walls, rooms, doors, windows, dimensions, BOQ, ceilings or engineering measurements. Structural changes, custom arbitrary meshes, photoreal image generation, animation and camera movement are unsupported by these actions. Say so honestly.
Room names may be Persian/Arabic; use their semantic type and supplied IDs. If more than one matching room/asset exists and the user's description does not identify one, ask for clarification. Do not invent IDs.
For add, use type, roomId, xMeters, yMeters, rotation; use normal realistic defaults by leaving width/depth/height null unless necessary or requested. For update/remove, use the existing assetId. On update leave every unrequested field null. Use null for unused fields. Adding/removing furniture is a visual user proposal, never source measurement.
Reuse an existing appliance when the user says 'put it in kitchen'; do not create a second one unless they request another. Preserve existing unrelated items. You may move or remove related furniture only when the user authorizes that in the request. For 'chairs around the dining table', add or reposition chairs facing the table; use the supplied rotation convention. Use a sensible number that fits or ask if insufficient space; no invisible/overlapping chairs.
Placement is in metres, X right, Y up. Footprint width/depth are metres. Rotation is counterclockwise about vertical Z. Bed/sofa/chair front is local +Y; cabinets/appliances front is local -Y. Chair rotation 0 faces +Y, 90 faces -X, 180 faces -Y, 270 faces +X. Preserve relative instructions (front of/next to/left/right) rather than placing anywhere.
Inspect target room polygons, walls, shafts, doors and ALL existing furniture before choosing coordinates. Place the entire rotated rectangle inside the room with at least .03m separation from other items and walls, and away from door swing/access (door width radius). Counters contain sinks/stoves: avoid these occupied zones. Search free positions along actual room boundaries; do not assume fixed layouts or coordinates. Never shrink appliances to impossible sizes to force a fit. Dressing table is a freestanding table with mirror; floor_lamp is a floor-standing lamp. freezer is an upright freezer. plant is a generic leafy houseplant; flower_pot is a generic flowering pot. Do not claim botanical species fidelity. Other kinds of lamps or freezer geometry are unsupported.
Allowed palette keys: wall,floor,ceiling,accent,glass,door,furniture,upholstery,textileAccent; color must be #RRGGBB. Furniture color uses update.color. Palette changes change color only, not textures. For preset style use style.value modern/minimal/luxury/classic. Complex material/brand requests beyond these representations require clarification.
If a validation failure is supplied, correct the entire plan while honoring the original request; no dropping operations just to pass. If no valid placement is possible, return clarify with a short reason. Do not include unsupported fields. Return only the supplied JSON schema.`;

export async function planScenePrompt({scene,prompt,language,model,requestAI,signal}){
 const context=promptSceneContext(scene),deadline=Date.now()+75000;
 let previous=null;
 for(let attempt=0;attempt<2;attempt++){
  const remaining=deadline-Date.now();if(remaining<1000)throw Object.assign(new Error('3D prompt timed out; no changes were saved.'),{status:504,code:'SCENE_EDIT_TIMEOUT'});
  const response=await requestAI({model,max_output_tokens:6000,input:[{role:'system',content:SCENE_PROMPT_INSTRUCTIONS},{role:'user',content:JSON.stringify({prompt,language,scene:context,previousValidation:previous})}],text:{format:{type:'json_schema',name:'ventra_scene_actions_v61',strict:true,schema:promptActionSchema}}},{signal,timeout:remaining,maxRetries:0});
  if(response.status==='incomplete'||!response.output_text)throw Object.assign(new Error('AI returned an incomplete edit; no changes were saved.'),{status:502,code:'SCENE_EDIT_INCOMPLETE'});
  let plan;try{plan=JSON.parse(response.output_text);}catch{throw Object.assign(new Error('AI returned invalid edit data; no changes were saved.'),{status:502,code:'SCENE_EDIT_INVALID'});}
  try{return {...applyPromptActions(scene,plan),message:plan.message,source:'openai-scene-actions-v61'};}
  catch(error){if(error.code!=='SCENE_EDIT_REJECTED'||attempt===1)throw error;previous={plan,problem:error.message};}
 }
}
