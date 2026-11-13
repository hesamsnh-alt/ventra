import {VERIFIED_PREVIEW_VERSION} from '../../src/lib/verifiedPreview.mjs';
import {previewAIKeyStatus} from '../../src/lib/previewAIConfig.mjs';
// Public, non-sensitive deployment identity. No credentials or AI calls.
export default async function handler(){
 return Response.json({routeVersion:VERIFIED_PREVIEW_VERSION,aiKeyStatus:previewAIKeyStatus(process.env.OPENAI_API_KEY)},{headers:{'Cache-Control':'no-store'}});
}
