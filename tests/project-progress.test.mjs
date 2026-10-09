import test from 'node:test';import assert from 'node:assert/strict';import {validatedProgress,meanProjectProgress} from '../src/lib/projectProgress.mjs';
test('manual progress accepts range and rejects empty or nonfinite values',()=>{assert.equal(validatedProgress('42.25'),42.25);for(const v of ['',null,Infinity,-1,101,'abc'])assert.throws(()=>validatedProgress(v));});
test('dashboard mean uses recorded progress and does not invent health',()=>{assert.equal(meanProjectProgress([{progress:20},{progress:80},{progress:null}]),50);assert.equal(meanProjectProgress([]),null);});
