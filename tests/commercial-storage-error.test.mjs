import test from 'node:test';
import assert from 'node:assert/strict';
import {commercialStorageError as message} from '../src/lib/commercialStorageError.mjs';
test('missing schema is distinguished from session, permission and network failures',()=>{
  for (const code of ['42P01','PGRST205','PGRST204','42703']) assert.match(message({code}),/migration/);
  for (const code of ['PGRST301','PGRST302','PGRST303']) assert.match(message({code}),/session/);
  assert.match(message({code:'42501'}),/access was denied/);
  assert.match(message({status:401}),/session/);
  assert.match(message({status:403}),/access was denied/);
  for (const error of [null,{},new Error('Failed to fetch'),{code:'PGRST000',message:'sensitive server details'}]) {
    const text=message(error);
    assert.doesNotMatch(text,/migration|sensitive server details/);
    assert.match(text,/draft is unchanged/);
  }
});
