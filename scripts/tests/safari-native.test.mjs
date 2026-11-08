import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
const read=p=>readFileSync(p,'utf8');
test('simulator dry run is offline and unsigned with package version',()=>{
 const out=execFileSync('bash',['scripts/safari-build.sh','simulator','Debug','--no-sign','--dry-run'],{encoding:'utf8'});
 assert.match(out,/generic\/platform=iOS Simulator/); assert.match(out,/CODE_SIGNING_ALLOWED=NO/); assert.match(out,/MARKETING_VERSION=0.1.0/); assert.doesNotMatch(out,/-allowProvisioningUpdates/);
});
test('reject invalid platform before any build',()=>{
 assert.throws(()=>execFileSync('bash',['scripts/safari-build.sh','invalid','Debug','--dry-run'],{stdio:'pipe'}));
});
test('native page responds to platform and settings errors',()=>{
 const elements=Object.fromEntries(['settings','status','instructions'].map(id=>[id,{textContent:'',hidden:false,addEventListener(){}}]));
 const context={document:{getElementById:id=>elements[id]},webkit:{messageHandlers:{controller:{postMessage(){}}}}};
 vm.runInNewContext(read('safari/Shared (App)/Resources/Script.js'),context);
 context.show('ios',null,false); assert.equal(elements.settings.hidden,true); assert.match(elements.instructions.textContent,/Settings > Apps > Safari/);
 context.show('ios',null,true); assert.equal(elements.settings.hidden,false);
 context.show('mac',true,true); assert.match(elements.status.textContent,/on/);
 context.settingsError(); assert.match(elements.status.textContent,/manually/);
});
test('native project keeps four target versions and iOS minimums aligned',()=>{
 const project=read('safari/Uzero.xcodeproj/project.xcproj');
 assert.equal((project.match(/"MARKETING_VERSION": "0.1.0"/g)||[]).length,4);
 assert.equal((project.match(/"CURRENT_PROJECT_VERSION": "1"/g)||[]).length,4);
 assert.equal((project.match(/"IPHONEOS_DEPLOYMENT_TARGET": "17.0"/g)||[]).length,2);
});
test('page permits zoom and uses a fluid scrollable container',()=>{
 assert.doesNotMatch(read('safari/Shared (App)/Resources/Base.lproj/Main.html'),/user-scalable=no/);
 assert.doesNotMatch(read('safari/Shared (App)/Resources/Style.css'),/min-width:\s*360px/);
 assert.match(read('safari/Shared (App)/ViewController.swift'),/isScrollEnabled = true/);
});
