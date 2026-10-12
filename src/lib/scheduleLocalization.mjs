import {translateText} from './i18n/translate.mjs';
// Translate the validation field, preserving the BOQ's original activity name.
export function localizeScheduleError(message,language){
 if(typeof message!=='string'||language==='en')return message;
 const numeric=message.match(/^(.*): enter a number between ([^ ]+) and ([^ ]+)\.$/);
 if(!numeric)return translateText(message,language);
 const field=translateText(numeric[1],language);
 return translateText(`${field}: enter a number between ${numeric[2]} and ${numeric[3]}.`,language);
}
