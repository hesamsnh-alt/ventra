import {commercialAdmin} from '@/lib/serverCommercial';
import {selectionBody,selectionResponse,selectionError,selectionData,selectionTokenHash,readSelectionReview,selectionFailure} from '@/lib/serverMaterialSelections';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request){try{const body=await selectionBody(request),db=commercialAdmin();
 if(body.action==='read')return selectionResponse((await readSelectionReview(db,body.token)).view);
 if(body.action!=='decide'||!['approved','rejected'].includes(body.decision)||body.consent!==true)throw selectionFailure('An explicit approval or rejection and consent are required.');
 const name=String(body.name||'').trim();if(name.length<2||name.length>100)throw selectionFailure('Enter your name (2–100 characters).');
 const result=selectionData(await db.rpc('ventra_decide_selection',{p_hash:selectionTokenHash(body.token),p_decision:body.decision,p_name:name}));
 if(result.error)throw selectionFailure(result.error==='stale'?'This version changed. Request a new review link.':'This review link is expired, revoked or already decided.',409);
 return selectionResponse((await readSelectionReview(db,body.token)).view);
 }catch(e){return selectionError(e);}}
