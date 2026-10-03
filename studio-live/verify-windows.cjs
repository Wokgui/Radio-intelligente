const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawn}=require('child_process');
const base=path.resolve(__dirname),snapshot=JSON.parse(fs.readFileSync(path.join(base,'workspace.json'),'utf8'));
const electron=require(path.resolve('node_modules/electron'));
const resources=path.join(path.dirname(electron),'resources');
for(const [name,item] of Object.entries(snapshot.files)){
 const text=fs.readFileSync(path.join(base,name),'utf8');
 if(crypto.createHash('sha256').update(text).digest('hex')!==item.hash)throw Error('Snapshot out of date: '+name);
 const target=path.join(resources,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);
}
fs.writeFileSync(path.join(resources,'studio-live-seed.json'),JSON.stringify(snapshot));
fs.cpSync(path.resolve('node_modules/yauzl'),path.join(resources,'app/node_modules/yauzl'),{recursive:true});
for(const name of ['pend','buffer-crc32'])fs.cpSync(path.resolve('node_modules',name),path.join(resources,'app/node_modules',name),{recursive:true});
const repo=path.dirname(base);
for(const name of ['vendor','cover-default.png','icon-192.png','icon-512.png','icon-maskable-192.png','apple-touch-icon.png','favicon-32.png','silence.wav','manifest.webmanifest']){
 const p=path.join(repo,name);if(fs.existsSync(p))fs.cpSync(p,path.join(resources,'webapp',name),{recursive:true});
}
const child=spawn(electron,['--disable-gpu'],{env:{...process.env,AIS_SMOKE_TEST:'1',ELECTRON_DISABLE_SECURITY_WARNINGS:'true'},stdio:'inherit'});
const timer=setTimeout(()=>{child.kill();console.error('Windows smoke timeout');process.exit(1)},180000);
child.on('error',e=>{clearTimeout(timer);console.error(e);process.exit(1)});
child.on('exit',code=>{clearTimeout(timer);process.exit(code===0?0:1)});
