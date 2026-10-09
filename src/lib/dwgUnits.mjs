export const DWG_UNIT_FACTORS=Object.freeze({m:1,mm:0.001,cm:0.01,ft:0.3048,in:0.0254});
export function confirmedDwgUnit(unit,reference){
 if(!Object.hasOwn(DWG_UNIT_FACTORS,unit)||!String(reference||'').trim())throw new Error('Select the drawing unit and enter a source reference.');
 return {unit,meterFactor:DWG_UNIT_FACTORS[unit],reference:String(reference).trim().slice(0,500),confirmedAt:new Date().toISOString()};
}
