// Return configuration state only. Never return, log or transform the key.
export function previewAIKeyStatus(value){
 if(typeof value!=='string'||!value.trim())return'missing';
 if(value!==value.trim()||/[^\x21-\x7e]/.test(value)||/^\*+$/.test(value))return'unusable_header';
 return'header_ready'; // Header syntax only; does not assert provider access.
}
