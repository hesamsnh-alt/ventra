import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {extractRasterPixelGraph,assemblePixelTopology,pixelGraphOverlay} from './rasterPixelGraph.mjs';
import {pixelGraphAnchors,compileClassifiedPixelGraph,sourceStorageAssets} from './rasterGraphCompiler.mjs';
import {compileRasterFloorplan,normalizeRasterPixelTrace} from './rasterFloorplanGeometry.mjs';
import {prepareRasterImageEvidence,inspectRasterImageEvidence,requireRasterImageEvidence} from './rasterImageEvidence.mjs';
import {VERIFIED_PREVIEW_VERSION} from './verifiedPreview.mjs';
import {applyRasterDoorSymbols} from './rasterDoorSymbols.mjs';
import {discoverRasterOpenings,sourceDoorGapCandidates} from './rasterOpeningDiscovery.mjs';
import {compactPixelClassificationInput,validateSourceBandCoverage} from './rasterClassificationInput.mjs';
import {PIXEL_CANDIDATE_ROLES,pixelCandidateRolesSchema,normalizePixelCandidateRoles} from './rasterCandidateRoles.mjs';
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const array=items=>({type:'array',items});
const text={type:'string'},number={type:'number'},nullableNumber={type:['number','null']};
const choice=(...values)=>({type:'string',enum:values});
const fail=(code,message,details={})=>{throw Object.assign(Error(message),{name:'PixelGraphError',code,details});};

export function pixelWallClassificationSchema(graph){
  const schema=object({complete:{type:'boolean'},confidence:number,title:text,
    candidateRoles:pixelCandidateRolesSchema(graph),
    openings:array(object({gapId:graph.gaps.length?choice(...graph.gaps.map(g=>g.id)):text,type:choice('door','window'),hingeSide:choice('start','end','unknown'),swingDirection:choice('clockwise','counterclockwise','unknown')})),
    rejectedSourceDoors:array(object({sourceDoorId:graph.gaps.some(g=>g.sourceDoor)?choice(...graph.gaps.filter(g=>g.sourceDoor).map(g=>g.id)):text,reason:choice('furniture','text','dimension','unreadable'),evidence:text})),
    inventory:object({enclosedSpaceNames:array(text),doorCount:number,windowCount:number}),missingFeatures:array(text)});
  schema.$defs={pixelCandidateRole:{type:'string',enum:PIXEL_CANDIDATE_ROLES}};
  return schema;
}
export function pixelRegionClassificationSchema(topology,anchors){
  const regionId=choice(...topology.regions.map(r=>r.id)),anchorId=anchors.length<=400?choice(...anchors.map(a=>a.id)):text;
  return object({title:text,confidence:number,wallHeightMeters:nullableNumber,
    regions:array(object({regionId,name:text,sourceText:text,fixtures:array(choice('bed','toilet','shower','bathtub','sofa','kitchen_cabinets','hob','oven','washing_machine','wardrobe','other')),type:choice('room','bedroom','living','kitchen','bathroom','corridor','balcony','laundry','storage','stair','other','unresolved'),
      context:choice('bedroom','entrance','stair_core','circulation','unassigned','living','kitchen','bathroom','balcony','laundry'),
      pattern:choice('none','hatch','cross','solid_fill','unknown'),details:choice('none','present','unknown'),
      explicitUse:choice('room','wardrobe','shaft','void','courtyard','lift_void','stair','shower','furniture','unknown'),
      parentRegionId:{type:['string','null'],enum:[...topology.regions.map(r=>r.id),null]}})),
    symbols:array(object({enclosureId:text,parentRegionId:regionId,sourceText:text,pattern:choice('none','hatch','cross','solid_fill','unknown'),details:choice('none','present','unknown'),explicitUse:choice('wardrobe','furniture','unknown')})),
    measurements:array(object({text,startAnchorId:anchorId,endAnchorId:anchorId,meters:number}))});
}
export function validatePixelClassification(graph,selection){
  if(!selection.complete||selection.missingFeatures?.length||selection.unresolvedCandidateIds?.length)fail('INCOMPLETE_PIXEL_CLASSIFICATION','The physical source lines are not fully classified; no replacement room grid was invented.',{
    complete:selection.complete===true,missingFeatures:selection.missingFeatures||[],unresolvedCandidateIds:selection.unresolvedCandidateIds||[],
    selectedWallCount:selection.walls?.length||0,candidateCount:graph.candidates.length,uncoveredBands:validateSourceBandCoverage(graph,{walls:selection.walls||[],nonWalls:selection.nonWalls||[]})
  });
  const ids=new Set(graph.candidates.map(c=>c.id)),seen=new Set();
  for(const item of [...(selection.walls||[]),...(selection.nonWalls||[])]){
    if(!ids.has(item.candidateId)||seen.has(item.candidateId))fail('INVALID_PIXEL_SELECTION','Candidate classification contains unknown or repeated IDs.');seen.add(item.candidateId);
  }
  const uncoveredBands=validateSourceBandCoverage(graph,selection);
  if(uncoveredBands.length)fail('INCOMPLETE_PIXEL_CLASSIFICATION','Measured thick source bands need selected wall coverage or an explicit non-wall interpretation.',{uncoveredBands});
  const doors=selection.openings.filter(o=>o.type==='door').length,windows=selection.openings.filter(o=>o.type==='window').length;
  if(doors!==selection.inventory?.doorCount||windows!==selection.inventory?.windowCount)fail('INCOMPLETE_OPENING_INVENTORY','Visible opening inventory does not agree with selected source gaps.');
  const rejected=new Map();for(const item of selection.rejectedSourceDoors||[]){
    if(!graph.gaps.some(g=>g.id===item.sourceDoorId&&g.sourceDoor)||rejected.has(item.sourceDoorId)||selection.openings.some(o=>o.gapId===item.sourceDoorId))fail('INVALID_PIXEL_OPENING','Unknown, duplicate or contradictory source-door review.');
    if(item.reason==='unreadable'||!String(item.evidence||'').trim())fail('INCOMPLETE_OPENING_INVENTORY','A source door observation remains unresolved.');rejected.set(item.sourceDoorId,item);
  }
  for(const gap of graph.gaps.filter(g=>g.sourceDoor))if(!selection.openings.some(o=>o.gapId===gap.id&&o.type==='door')&&!rejected.has(gap.id))fail('INCOMPLETE_OPENING_INVENTORY','A locally observed door was silently omitted from classification.',{sourceDoorId:gap.id});
}
function regionOverlay(graph,topology,anchors){
  const labels=[...topology.regions,...(topology.symbolEnclosures||[])].map(r=>{const x=r.polygon.reduce((s,p)=>s+p.x/r.polygon.length,0),y=r.polygon.reduce((s,p)=>s+p.y/r.polygon.length,0);return`<polygon points="${r.polygon.map(p=>`${p.x},${p.y}`).join(' ')}" fill="#1597cf" fill-opacity=".06" stroke="#1597cf"/><text x="${x}" y="${y}" font-size="15">${r.id}</text>`;}).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${graph.imageWidth}" height="${graph.imageHeight}"><g fill="#083e64" font-family="sans-serif">${labels}${anchors.map(a=>`<circle cx="${a.x}" cy="${a.y}" r="2"/><text x="${a.x+3}" y="${a.y-3}" font-size="8">${a.id}</text>`).join('')}</g></svg>`;
}
async function labelledImage(buffer,overlay){const data=await sharp(buffer).composite([{input:Buffer.from(overlay)}]).jpeg({quality:90,chromaSubsampling:'4:4:4'}).toBuffer();return`data:image/jpeg;base64,${data.toString('base64')}`;}

export function pixelClassificationViewLayout(graph){
  const views=[];
  const extent=graph.contentExtent||{left:0,top:0,width:graph.imageWidth,height:graph.imageHeight};
  // A source face, its measured centre and its remainder are alternatives,
  // not three physical walls. Do not draw all of their labels over each other.
  const groups=['stroke','solid_band','face_pair','fragments'].map(kind=>graph.candidates.filter(c=>kind==='fragments'?['stroke_fragment','observed_wall_fragment'].includes(c.kind):c.kind===kind)).filter(g=>g.length);
  if(!groups.length)return views;
  const budget=Math.floor(9/groups.length);
  let columns=Math.min(Math.ceil(extent.width/850),budget),rows=Math.min(Math.ceil(extent.height/850),Math.max(1,Math.floor(budget/columns)));
  if(extent.height>extent.width){rows=Math.min(Math.ceil(extent.height/850),budget);columns=Math.min(Math.ceil(extent.width/850),Math.max(1,Math.floor(budget/rows)));}
  for(const candidates of groups)for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
    const left=Math.max(0,extent.left+Math.floor(col*extent.width/columns)-35),top=Math.max(0,extent.top+Math.floor(row*extent.height/rows)-35),right=Math.min(graph.imageWidth,extent.left+Math.ceil((col+1)*extent.width/columns)+35),bottom=Math.min(graph.imageHeight,extent.top+Math.ceil((row+1)*extent.height/rows)+35);
    const viewport={left,top,right,bottom};
    views.push({kind:candidates[0].kind,viewport,candidateIds:candidates.map(c=>c.id)});
  }
  return views;
}
export async function pixelClassificationDetailViews(buffer,graph){
  const images=[];
  for(const view of pixelClassificationViewLayout(graph)){
    const ids=new Set(view.candidateIds),{left,top,right,bottom}=view.viewport;
    const labelled=await sharp(buffer).composite([{input:Buffer.from(pixelGraphOverlay({...graph,candidates:graph.candidates.filter(c=>ids.has(c.id)),gaps:[]},{layer:'all',viewport:view.viewport}))}]).png().toBuffer();
    const data=await sharp(labelled).extract({left,top,width:right-left,height:bottom-top}).jpeg({quality:90,chromaSubsampling:'4:4:4'}).toBuffer();images.push(`data:image/jpeg;base64,${data.toString('base64')}`);
  }
  return images;
}

// Two specific semantic tasks at most. There is no free-coordinate trace call,
// no model-generated rectangle, and no retry after a paid classification fails.
export async function runPixelGraphPipeline({buffer,classify,diagnostics={}}){
  diagnostics.format='ventra-raster-diagnostic-v1';diagnostics.build=VERIFIED_PREVIEW_VERSION;diagnostics.accepted=false;diagnostics.trace=null;diagnostics.attempts=[];
  const graph=await extractRasterPixelGraph(buffer);
  const sourceOpenings=await discoverRasterOpenings(buffer,graph);
  graph.gaps.push(...sourceDoorGapCandidates(graph,sourceOpenings));
  if(graph.gaps.length>700)fail('PIXEL_GRAPH_TOO_COMPLEX','Opening observations exceed the classification budget. No model request was made.');
  diagnostics.sourceOpeningDiscovery=sourceOpenings;
  diagnostics.pixelGraph=graph;diagnostics.imageWidth=graph.imageWidth;diagnostics.imageHeight=graph.imageHeight;diagnostics.imageHash=createHash('sha256').update(buffer).digest('hex').slice(0,16);
  if(graph.candidates.length<3)fail('NO_PIXEL_STRUCTURE','No supported building lines were extracted. No model request was made.');
  const original=`data:image/jpeg;base64,${buffer.toString('base64')}`;
  const rawSelection=await classify({stage:'classify_source_lines',schema:pixelWallClassificationSchema(graph),original,image:await labelledImage(buffer,pixelGraphOverlay(graph)),images:await pixelClassificationDetailViews(buffer,graph),data:{...compactPixelClassificationInput(graph,sourceOpenings),detailViews:pixelClassificationViewLayout(graph)},
    prompt:'Do not discard a visible line solely because it is faint, gray, thin or lower contrast. Classify its architectural role using continuity, junctions and source context; faint text, dimensions and furniture are still non-walls. Classify the provided SOURCE-PIXEL candidate IDs. Coordinates are already measured; never write or invent coordinates. Select every actual physical wall, including thin outlined walls and all exterior balcony/recess boundaries. Measured solid_band candidates already represent the filled wall centre and retain short jambs. Prefer them when the source wall is filled; do not also select overlapping face alternatives. Face-pair candidates represent one wall between two visible faces: choose the pair OR its raw face strokes, never both. Select physical wall runs, not every alternative representation. candidateRoles requires EXACTLY ONE role for EVERY candidate ID: external_wall, internal_wall, alternative_face, furniture, door_symbol, window_symbol, text, dimension, noise or unresolved. Classify redundant representations as alternative_face; never classify both a measured band and one of its overlapping alternatives as a wall. Classify furniture enclosure boundary strokes as furniture. complete=true confirms you reviewed the whole source. A requiredSourceBandId not represented by a wall still needs its explicit visible non-wall role; ignore furniture/cabinet/wardrobe edges, door leaves/arcs, labels and dimension lines. sourceDoors are local pixel observations with arc and thin radial-leaf support, not AI guesses. Inspect each observed_arc_and_leaf gap and preserve its source ID when it represents a real door. Every local source-door observation must be selected or explicitly reviewed in rejectedSourceDoors with visible non-door evidence; never silently omit it. Its endpointHosts permit a door at a wall end or perpendicular junction: select a parallel host or hosts at both jambs; a leaf must not be selected as a wall. Other opening gaps are hypotheses, not walls: select only visibly supported door/window gaps with BOTH host candidates selected. Inventory all visible doors/windows and enclosed space names before returning. Report complete=false for missing geometry; do not simplify the drawing to its exterior rectangle. An image with real interior rooms requires its interior wall topology. The second image labels original ink/solid-band IDs. Following detail crops separate raw strokes, filled wall centres, face-pairs and fragments into DIFFERENT images so alternative representations never share a label layer. detailViews lists each crop in image order with its full-source pixel viewport and candidate IDs. measuredWallAlternatives explicitly lists incompatible overlapping representations: if selecting candidateId, do not also select any of its overlappingAlternativeIds. Alternatives may cover different extents; use their non-overlapping remainder fragments where a real wall continues. A solid_band sourceIds list includes its original boundary faces: these represent ONE physical wall, not extra partitions. A face_pair uses two measured faces; two raw faces do not become two physical walls. Review the clean original when a label or leader overlaps a fixture. Missing room-use semantics or furniture identification belong to the second stage; this first stage must still assign furniture roles to their boundary strokes and never silently omit a physical wall. These generated IDs and leader lines are not source geometry. SOURCE DATA coordinates locate candidates in the full original image, not within crop coordinates.'});
  diagnostics.wallClassification=rawSelection;
  const selection=normalizePixelCandidateRoles(graph,rawSelection);
  diagnostics.wallClassification=selection;validatePixelClassification(graph,selection);
  const topology=assemblePixelTopology(graph,selection);diagnostics.pixelTopology=topology;
  const furniture=selection.nonWalls.filter(s=>s.reason==='furniture');topology.symbolEnclosures=[];
  if(furniture.length>=3){
    try{topology.symbolEnclosures=assemblePixelTopology(graph,{walls:furniture.map(s=>({candidateId:s.candidateId,type:'internal'})),openings:[]}).enclosures;}
    catch(error){if(error.code!=='OPEN_PIXEL_TOPOLOGY')throw error;diagnostics.unclosedFurnitureSymbols=true;}
  }
  if(topology.regions.length<selection.inventory.enclosedSpaceNames.length)fail('INCOMPLETE_ROOM_TOPOLOGY','Selected walls enclose fewer spaces than the visible source inventory.',{regions:topology.regions.length,inventory:selection.inventory.enclosedSpaceNames});
  const anchors=pixelGraphAnchors(graph,topology);
  const semantics=await classify({stage:'classify_enclosed_regions',schema:pixelRegionClassificationSchema(topology,anchors),original,image:await labelledImage(buffer,regionOverlay(graph,topology,anchors)),data:{regions:topology.regions,symbolEnclosures:topology.symbolEnclosures,anchors},
    prompt:'Name and interpret EVERY enclosed source region by regionId. All polygons and anchors are computed from pixels: never invent coordinates or change shapes. Copy the actual readable room label into sourceText (empty string if none); separately inventory only VISIBLE fixtures. Text has priority over furniture guesses. PROJECT DICTIONARY: B.R / BR = bathroom/toilet; ROOM = a room, not unknown; Bedroom / Master Room = bedroom; Living Room = living; Kitchen = kitchen; Landry / Laundry = laundry. If ROOM contains a bed, classify bedroom. Without readable labels use bed -> bedroom, toilet/shower -> bathroom, sofa -> living, kitchen cabinets/hob -> kitchen. If neither text nor fixtures identify its use, preserve the physical room as type other, not a fabricated bedroom. Drawing convention: an ENCLOSED hatched/crossed/solid-filled area with NO interior details in an entrance, stair core, circulation or unassigned core is an excluded void, with no floor; do not turn it into storage. Interpret EVERY symbolEnclosure separately in symbols, with its real parentRegionId; furniture enclosures are not architectural floor holes. A hatched/crossed SUBREGION within a BEDROOM is a wardrobe, not a floor hole; set its adjacent parentRegionId to that bedroom. A room-floor hatch is not automatically a wardrobe. Detailed stairs, showers and actual furniture are not voids merely because a symbol crosses them. Respect explicit labels. Use unresolved only for unclear physical region boundaries, not merely an unknown room use. A wardrobe is not a separate bedroom or empty floor opening. Copy only readable printed dimensions in metres, with endpoints identified by their exact source anchor IDs. Overall dimensions should use their actual reference faces/ticks, not arbitrary nearby room nodes. Include no guessed dimensions or furniture sizes. Use null for unannotated wall height. The labelled second image contains generated region/anchor IDs, not original dimensions.'});
  diagnostics.regionClassification=semantics;
  const compiled=compileClassifiedPixelGraph(graph,selection,semantics,topology);
  const evidence=await prepareRasterImageEvidence(buffer);compiled.trace.openings=applyRasterDoorSymbols(compiled.trace,evidence);
  diagnostics.rawPixelTrace=compiled.trace;diagnostics.trace=normalizeRasterPixelTrace(compiled.trace,diagnostics);diagnostics.spaceInterpretations=compiled.spaceInterpretations;diagnostics.storage=compiled.storage;
  const alignment=inspectRasterImageEvidence(compiled.trace,evidence);diagnostics.imageEvidence=alignment;requireRasterImageEvidence(alignment);
  const scene=compileRasterFloorplan(diagnostics.trace,diagnostics);
  scene.assets=sourceStorageAssets(compiled,scene);
  for(const opening of scene.openings){const source=compiled.trace.openings.find(o=>o.id===opening.id);if(source){opening.swingEvidence=source.swingEvidence;opening.roomDirections=source.roomDirections;opening.exteriorSwing=source.exteriorSwing;opening.openAngleDegrees=source.swingEvidence?.status==='observed'?source.swingEvidence.angleDegrees:0;opening.orientationSource=source.swingEvidence?.status==='observed'?'source_image_y_down':'unresolved';}}
  if(scene.assets.length)scene.geometryValidation.assumptions.push('Wardrobe floor footprints are source-measured; wardrobe height is a schematic default, not a printed dimension.');
  scene.geometryValidation.pixelSupport=alignment.status;scene.geometryValidation.acceptanceBuild=VERIFIED_PREVIEW_VERSION;scene.geometryValidation.coordinateAuthority='source_pixel_graph';scene.geometryValidation.spacePolicyVersion=compiled.spacePolicyVersion;
  scene.sourceStorageRegions=compiled.storage;diagnostics.accepted=true;diagnostics.validation=scene.geometryValidation;
  return{scene,diagnostics,validation:scene.geometryValidation,mode:'analyze',source:'pixel-graph-with-semantic-classification',routeVersion:VERIFIED_PREVIEW_VERSION,needsManualReview:true,warning:'Geometry coordinates come from source pixels. Source-line classification, hatch context and opening completeness require visual review; unannotated heights remain assumptions.'};
}
