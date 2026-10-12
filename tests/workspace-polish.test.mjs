import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../src/app/projects/[id]/',import.meta.url);
test('workspace disclosures keep controls mounted and use native keyboard interaction',()=>{
 const source=fs.readFileSync(new URL('WorkspaceDisclosure.jsx',root),'utf8');
 assert.match(source,/<details/);assert.match(source,/<summary>/);
 assert.match(source,/\{children\}/);assert.doesNotMatch(source,/open\s*&&\s*children/);
});
test('workspace polish includes mobile touch sizing, focus and printable collapsed content',()=>{
 const css=fs.readFileSync(new URL('WorkspacePolish.css',root),'utf8');
 assert.match(css,/@media\(max-width:700px\)/);assert.match(css,/min-height:44px/);
 assert.match(css,/:focus-visible/);assert.match(css,/::details-content\{content-visibility:visible!important/);
 assert.doesNotMatch(css,/canvas[^}]*display\s*:\s*none/);
});
