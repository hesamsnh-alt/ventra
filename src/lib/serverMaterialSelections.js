import 'server-only';
import {randomBytes,createHash} from 'node:crypto';
import {account} from './serverBilling';
import {commercialAdmin} from './serverCommercial';
import {validProjectId} from './commercialAccess.mjs';
import {emptySelectionDraft,normalizeSelectionDraft,selectionSnapshot,publicSelectionSnapshot} from './materialSelections.mjs';
export const selectionFailure=(message,status=400)=>Object.assign(Error(message),{status});
export async function selectionBody(request){if(!request.headers.get('content-type')?.includes('application/json'))throw selectionFailure('JSON required.',415);const raw=await request.text();if(raw.length>512*1024)throw selectionFailure('Selections exceed 512 KB.',413);try{return JSON.parse(raw);}catch{throw selectionFailure('Invalid JSON.');}}
export function selectionResponse(value,status=200){return Response.json(value,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});}
export function selectionError(e){return selectionResponse({success:false,error:e.status?e.message:'Selection storage unavailable. / ذخیره‌سازی انتخاب‌ها در دسترس نیست.',code:e.code||'SELECTION_ERROR'},e.status||503);}
export function selectionData(result){if(result.error){if(result.error.code==='23505')throw selectionFailure('Version conflict. Reload before saving. / نسخه تغییر کرده؛ دوباره بارگذاری کن.',409);throw selectionFailure('Selection storage unavailable; check the material selection migration. / ذخیره‌سازی انتخاب‌ها آماده نیست؛ migration را بررسی کن.',503);}return result.data;}
export async function assertSelectionAccess(db,user,projectId,write=false){
 if(!validProjectId(projectId))throw selectionFailure('Invalid project ID.');
 const project=selectionData(await db.from('projects').select('user_id').eq('id',projectId).maybeSingle());if(!project)throw selectionFailure('Project access denied.',403);
 let role='owner';if(project.user_id!==user.id){const member=selectionData(await db.from('ventra_project_members').select('role').eq('project_id',projectId).eq('user_id',user.id).maybeSingle());role=member?.role;if(!(write?['manager','supervisor']:['manager','supervisor','viewer']).includes(role))throw selectionFailure('Project access denied.',403);}
 return {owner:project.user_id,canEdit:role!=='viewer'};
}
export async function selectionContext(request,projectId,write=false){const user=await account(request),db=commercialAdmin();const access=await assertSelectionAccess(db,user,projectId,write);return {user,db,...access};}
export async function readSelectionBoard(db,projectId){return selectionData(await db.from('ventra_selection_boards').select('*').eq('project_id',projectId).maybeSingle());}
export function boardValue(row){return row||{revision:0,document:{draft:emptySelectionDraft(),baseline:null,approval:null},updated_at:null};}
export function expectedRevision(value){if(!Number.isSafeInteger(value)||value<0)throw selectionFailure('A loaded revision is required.');return value;}
export async function saveSelectionBoard(db,projectId,actor,input,expected){
 expectedRevision(expected);let draft;try{draft=normalizeSelectionDraft(input);}catch(e){throw selectionFailure(e.message);}
 if(expected===0)return selectionData(await db.from('ventra_selection_boards').insert({project_id:projectId,revision:1,document:{draft,baseline:null,approval:null},updated_by:actor}).select('*').single());
 const previous=await readSelectionBoard(db,projectId);if(!previous||previous.revision!==expected)throw selectionFailure('Version changed. Reload first. / نسخه تغییر کرده؛ دوباره بارگذاری کن.',409);
 const row=selectionData(await db.from('ventra_selection_boards').update({document:{...previous.document,draft},revision:expected+1,updated_by:actor,updated_at:new Date().toISOString()}).eq('project_id',projectId).eq('revision',expected).select('*').maybeSingle());if(!row)throw selectionFailure('Version changed. Reload first.',409);return row;
}
export function selectionTokenHash(token){if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw selectionFailure('Invalid or expired review link.',404);return createHash('sha256').update(token).digest('hex');}
export async function createSelectionShare(db,projectId,actor,expected){
 expectedRevision(expected);const board=await readSelectionBoard(db,projectId);if(!board||board.revision!==expected)throw selectionFailure('Save and reload the current version before sharing.',409);
 let snapshot;try{snapshot=selectionSnapshot(board.document.draft);}catch(e){throw selectionFailure(e.message);}
 const token=randomBytes(32).toString('base64url'),expires=new Date(Date.now()+7*86400000).toISOString();
 const share=selectionData(await db.from('ventra_selection_shares').insert({project_id:projectId,board_revision:expected,token_hash:selectionTokenHash(token),snapshot,previous:board.document.baseline,created_by:actor,expires_at:expires}).select('id,expires_at').single());return {...share,token};
}
export async function readSelectionReview(db,token){const hash=selectionTokenHash(token);const share=selectionData(await db.from('ventra_selection_shares').select('*').eq('token_hash',hash).maybeSingle());if(!share||share.revoked||new Date(share.expires_at).getTime()<=Date.now())throw selectionFailure('Invalid, revoked or expired review link.',404);const board=await readSelectionBoard(db,share.project_id);const stale=share.decision==='pending'&&board?.revision!==share.board_revision;return {share,stale,view:{snapshot:publicSelectionSnapshot(share.snapshot,share.previous),decision:share.decision,decidedName:share.decided_name,decidedAt:share.decided_at,expiresAt:share.expires_at,stale}};}
