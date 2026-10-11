import test from 'node:test';
import assert from 'node:assert/strict';
import {operatorAllowance,isOperator} from '../src/lib/operatorAllowance.mjs';
test('private owner access preserves other accounts and requires explicit server configuration',()=>{
 const env={VENTRA_FREE_USER_ID:'owner'};
 assert.equal(isOperator('owner',env),true);
 assert.equal(operatorAllowance('owner',0,env),2147483647);
 assert.equal(operatorAllowance('customer',30,env),30);
 assert.equal(operatorAllowance('customer',0,env),0);
 assert.equal(isOperator(undefined,{}),false);
 assert.equal(operatorAllowance('owner',30,{}),30);
});
