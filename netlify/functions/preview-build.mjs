import {VERIFIED_PREVIEW_VERSION} from '../../src/lib/verifiedPreview.mjs';
// Public, non-sensitive deployment identity. No credentials or AI calls.
export default async function handler(){
 return Response.json({routeVersion:VERIFIED_PREVIEW_VERSION},{headers:{'Cache-Control':'no-store'}});
}
