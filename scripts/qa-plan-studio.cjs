// Run against a local test server; never opens or changes a saved customer project.
const{chromium}=require('playwright');const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const context=await browser.newContext({viewport:{width:1600,height:1100},acceptDownloads:true}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.pathname.startsWith('/api/')){requests.push(u.pathname);return r.abort();}if(!['localhost','127.0.0.1'].includes(u.hostname)&&!['data:','blob:'].includes(u.protocol))return r.abort();return r.continue();});
 try{
 await page.goto((process.env.PLAN_QA_URL||'http://localhost:3000')+'/plan-studio',{waitUntil:'networkidle',timeout:60000});await page.getByTestId('plan-canvas').waitFor();
 const command=page.getByLabel('CAD command line',{exact:true});async function cmd(text){await command.fill(text);await command.press('Enter');}
 for(const value of ['L','0,0','@400<0','@300<90','C'])await cmd(value);assert.equal(await page.locator('g[data-entity-type="line"]').count(),3);
 await page.getByRole('button',{name:'2D',exact:true}).click();
 for(const value of ['FLOOR','0,0','500,0','500,400','0,400','C'])await cmd(value);assert.equal(await page.locator('g[data-entity-type="polyline"]').count(),1);
 for(const value of ['DLI','0,0','400,0','0,-50'])await cmd(value);assert.equal(await page.locator('g[data-entity-type="dimension"]').count(),1);
 for(const value of ['T','100,100'])await cmd(value);assert.equal(await page.locator('g[data-entity-type="text"]').count(),1);
 for(const value of ['BP','200,200'])await cmd(value);assert.equal(await page.locator('g[data-entity-type="plate"]').count(),1);
 await page.getByRole('button',{name:'Save',exact:false}).first().click();await page.waitForTimeout(900);await page.reload({waitUntil:'networkidle'});await page.getByTestId('plan-canvas').waitFor();assert.equal(await page.locator('g[data-entity-type="line"]').count(),3);assert.equal(await page.locator('g[data-entity-type="plate"]').count(),1);
 await page.locator('.ps-export summary').click();let wait=page.waitForEvent('download');await page.getByRole('button',{name:'JSON · editable',exact:true}).click();const json=await wait;await json.saveAs('/tmp/ventra-plan-qa.json');assert.equal(JSON.parse(fs.readFileSync('/tmp/ventra-plan-qa.json','utf8')).entities.length,7);
 for(const [label,name]of[['JPG','/tmp/ventra-plan-qa.jpg'],['PDF · A3','/tmp/ventra-plan-qa.pdf'],['DXF','/tmp/ventra-plan-qa.dxf']]){wait=page.waitForEvent('download',{timeout:30000});await page.getByRole('button',{name:label,exact:true}).click();await(await wait).saveAs(name);assert.ok(fs.statSync(name).size>100);}
 await page.locator('.ps-export summary').click();await page.getByRole('button',{name:'SPLIT',exact:true}).click();await page.waitForTimeout(1000);await page.screenshot({path:'/tmp/ventra-plan-studio-desktop.png',fullPage:true});
 assert.equal(errors.length,0,'Page runtime errors: '+errors.join('; '));assert.equal(requests.length,0,'No API calls from independent plan route');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/ventra-plan-studio-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2));
 console.log(JSON.stringify({passed:true,entities:7,exports:['JSON','DXF','JPG','PDF'],reloadPreservesDrawing:true,apiCalls:requests,pageErrors:errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
