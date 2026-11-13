import test from 'node:test';import assert from 'node:assert/strict';
import {interpretRasterSpace,applyRasterSpacePolicy,inferRasterRoomUse} from '../src/lib/rasterSpaceSemantics.mjs';
for(const text of ['B.R','BR','b.r.',' B. R '])test(`project abbreviation ${text} means bathroom`,()=>assert.equal(inferRasterRoomUse({sourceText:text,fixtures:['bed']}).type,'bathroom'));
for(const [sourceText,type] of [['Master Room','bedroom'],['Living Room','living'],['Kitchen','kitchen'],['ROOM','room'],['اتاق','room'],['اتاق خواب','bedroom'],['دستشویی','bathroom'],['Landry','laundry']])test(`printed ${sourceText} identifies ${type}`,()=>assert.equal(inferRasterRoomUse({sourceText,fixtures:[]}).type,type));
for(const [fixture,type] of [['bed','bedroom'],['toilet','bathroom'],['sofa','living'],['kitchen_cabinets','kitchen']])test(`visible ${fixture} identifies use without a label`,()=>assert.equal(inferRasterRoomUse({fixtures:[fixture]}).type,type));
test('ROOM plus a visible bed identifies bedroom; explicit Kitchen still wins over a sofa',()=>{assert.equal(inferRasterRoomUse({sourceText:'ROOM',fixtures:['bed']}).type,'bedroom');assert.equal(inferRasterRoomUse({sourceText:'Kitchen',fixtures:['sofa']}).type,'kitchen');});
test('unlabelled empty floor stays unknown without a fabricated bedroom',()=>assert.equal(inferRasterRoomUse().type,'other'));
test('an explicitly named usable room is not deleted just because its floor is hatched',()=>assert.equal(interpretRasterSpace({explicitUse:'room',pattern:'hatch',context:'bedroom',details:'none',enclosed:true}).removeFloor,false));
for(const context of ['entrance','stair_core','circulation','unassigned'])for(const pattern of ['hatch','solid_fill'])test(`closed ${pattern} with no details at ${context} removes floor`,()=>assert.equal(interpretRasterSpace({enclosed:true,pattern,details:'none',context}).removeFloor,true));
for(const pattern of ['hatch','cross','solid_fill'])test(`bedroom ${pattern} is storage, never a floor hole`,()=>assert.deepEqual(interpretRasterSpace({enclosed:true,pattern,details:'none',context:'bedroom'}),{role:'wardrobe',removeFloor:false,reason:'bedroom_storage_pattern'}));
test('detailed staircase, shower and furniture remain physical uses',()=>{
 for(const explicitUse of ['stair','shower','furniture'])assert.equal(interpretRasterSpace({enclosed:true,pattern:'hatch',details:'present',context:'stair_core',explicitUse}).removeFloor,false);
});
test('unmarked empty room, open hatched area and an ambiguous cross are not silently deleted',()=>{
 for(const space of [{enclosed:true,pattern:'none',details:'none',context:'entrance'},{enclosed:false,pattern:'hatch',details:'none',context:'entrance'},{enclosed:true,pattern:'cross',details:'unknown',context:'living'}])assert.equal(interpretRasterSpace(space).removeFloor,false);
});
test('explicit lift void is kept separate from a wardrobe interpretation',()=>assert.equal(interpretRasterSpace({enclosed:true,pattern:'cross',context:'bedroom',details:'none',explicitUse:'lift_void'}).role,'void'));
test('interpretation leaves source evidence unchanged',()=>{const s=[{enclosed:true,pattern:'hatch',details:'none',context:'entrance'}],before=JSON.stringify(s);assert.equal(applyRasterSpacePolicy(s)[0].interpretation.role,'void');assert.equal(JSON.stringify(s),before);});
