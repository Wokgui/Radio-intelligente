const fs=require('fs'),path=require('path'),crypto=require('crypto');
const REPO='Wokgui/Radio-intelligente',BRANCH='feature/interface-studio-live',REMOTE='studio-live/workspace.json';
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
const validName=n=>typeof n==='string'&&(/^(webapp\/[a-z0-9][a-z0-9_.-]*\.(html|css|js|json)|app\/[a-z0-9][a-z0-9_.-]*\.cjs|app\/package\.json)$/i.test(n));
function validate(snapshot,allowed){
  if(snapshot?.schema!==1||!snapshot.files||typeof snapshot.files!=='object'||Array.isArray(snapshot.files))throw Error('Version partagée invalide.');
  const names=Object.keys(snapshot.files);if(names.length!==allowed.length||names.some(n=>!allowed.includes(n)))throw Error('Liste de fichiers partagés différente. Une mise à jour complète du programme est nécessaire.');
  let size=0;for(const name of names){const item=snapshot.files[name];if(!validName(name)||typeof item?.text!=='string'||typeof item.hash!=='string'||digest(item.text)!==item.hash)throw Error('Fichier partagé invalide : '+name);size+=Buffer.byteLength(item.text);if(size>5*1024*1024)throw Error('Version partagée trop volumineuse.');}
  return snapshot;
}
function plan(local,base,remote){const incoming=[],dirty=[],conflicts=[];for(const [name,item]of Object.entries(remote.files)){const hash=digest(local[name]);if(hash===item.hash)continue;if(hash===base[name])incoming.push(name);else if(item.hash===base[name])dirty.push(name);else conflicts.push(name);}return {incoming,dirty,conflicts};}
function create({app,safeStorage,root,seedPath,notify=()=>{},fetcher=fetch}){
  const seed=JSON.parse(fs.readFileSync(seedPath,'utf8')),allowed=Object.keys(seed.files);validate(seed,allowed);
  const file=path.join(app.getPath('userData'),'studio-sync.json'),secret=path.join(app.getPath('userData'),'studio-sync-key.bin');
  let state={enabled:true,autoPublish:false,base:Object.fromEntries(Object.entries(seed.files).map(([n,x])=>[n,x.hash])),updated:null},token='',busy=false,last=null,timer,stopped=false;
  try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));state={...state,...saved};}catch{}
  try{if(safeStorage.isEncryptionAvailable()&&fs.existsSync(secret))token=safeStorage.decryptString(fs.readFileSync(secret));}catch{}
  function persist(){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(state));fs.renameSync(tmp,file);}
  function locate(name){if(!allowed.includes(name)||!validName(name))throw Error('Fichier non partagé.');const f=path.join(root,...name.split('/'));let part=root;for(const p of name.split('/')){part=path.join(part,p);if(fs.lstatSync(part).isSymbolicLink())throw Error('Lien symbolique refusé.');}return f;}
  function local(){return Object.fromEntries(allowed.map(n=>[n,fs.readFileSync(locate(n),'utf8')]));}
  function status(){return {ok:true,repository:REPO,branch:BRANCH,enabled:state.enabled,connected:!!token,autoPublish:state.autoPublish,busy,updated:state.updated,conflicts:state.conflicts||[],message:state.message||'Synchronisation prête.',restartRequired:!!state.restartRequired,sharedFiles:allowed.length};}
  function emit(message){if(message)state.message=message;notify(status());}
  async function api(endpoint,method='GET',body){const r=await fetcher('https://api.github.com/repos/'+REPO+'/'+endpoint,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error(r.status===401||r.status===403?'Autorisation GitHub refusée. Vérifie l’accès au dépôt.':r.status===422?'La branche a changé pendant la publication. Actualise puis réessaie.':'GitHub indisponible ('+r.status+').');return r.json();}
  async function publicSnapshot(){const url='https://raw.githubusercontent.com/'+REPO+'/'+BRANCH+'/'+REMOTE;const r=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(30000),headers:state.etag&&last?{'If-None-Match':state.etag}:{}});if(r.status===304&&last)return last;if(!r.ok)throw Error('Version partagée indisponible ('+r.status+').');const snapshot=validate(await r.json(),allowed);state.etag=r.headers.get('etag')||null;last=snapshot;return snapshot;}
  function applySnapshot(snapshot,choice){
    const content=local(),diff=plan(content,state.base,snapshot);
    if(diff.conflicts.length&&!choice){state.conflicts=diff.conflicts;persist();emit('Des fichiers ont changé des deux côtés. Aucun fichier n’a été remplacé.');return diff;}
    const selected=choice==='remote'?[...diff.incoming,...diff.conflicts]:diff.incoming;
    if(selected.length){const backup=path.join(app.getPath('userData'),'studio-sync-backups',crypto.randomUUID()+'.json');fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,JSON.stringify({files:Object.fromEntries(selected.map(n=>[n,content[n]])),at:new Date().toISOString()}));const written=[];try{for(const name of selected){if(digest(fs.readFileSync(locate(name),'utf8'))!==digest(content[name]))throw Error('Un fichier vient de changer. Réessaie la synchronisation.');const tmp=locate(name)+'.sync-tmp';fs.writeFileSync(tmp,snapshot.files[name].text);fs.renameSync(tmp,locate(name));written.push(name);}}catch(e){for(const name of written)fs.writeFileSync(locate(name),content[name]);throw e;}if(selected.some(n=>n.startsWith('app/')))state.restartRequired=true;}
    // Choosing local acknowledges the remote base while retaining local edits for publication.
    state.base=Object.fromEntries(Object.entries(snapshot.files).map(([n,x])=>[n,x.hash]));state.conflicts=[];state.updated=new Date().toISOString();persist();emit(selected.length?'Changements reçus : '+selected.length+' fichier(s).':'À jour. Tes modifications locales sont conservées.');return {...diff,incoming:selected};
  }
  async function publish(){
    if(!token)throw Error('Connecte GitHub dans Studio pour publier depuis ce PC.');
    const ref=await api('git/ref/heads/'+BRANCH),parent=ref.object.sha,commit=await api('git/commits/'+parent),tree=await api('git/trees/'+commit.tree.sha+'?recursive=1');
    if(tree.truncated)throw Error('Dépôt trop volumineux pour cette synchronisation.');const item=tree.tree.find(x=>x.path===REMOTE);if(!item)throw Error('Version partagée absente du dépôt.');const blob=await api('git/blobs/'+item.sha),remote=validate(JSON.parse(Buffer.from(blob.content.replace(/\s/g,''),'base64').toString('utf8')),allowed);
    const merged=applySnapshot(remote);if(merged.conflicts.length)return;
    const contents=local(),snapshot={schema:1,version:seed.version,updated:new Date().toISOString(),files:{}};
    for(const name of allowed){const text=contents[name];if(/(?:github_pat_[A-Za-z0-9_]{15,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text))throw Error('Une information secrète semble présente dans '+name+'. Elle ne sera pas publiée.');snapshot.files[name]={text,hash:digest(text)};}
    const changes=allowed.filter(n=>snapshot.files[n].hash!==remote.files[n].hash);if(!changes.length){emit('À jour. Rien à publier.');return;}
    const entries=[{path:REMOTE,mode:'100644',type:'blob',content:JSON.stringify(snapshot)},...changes.map(n=>({path:'studio-live/'+n,mode:'100644',type:'blob',content:contents[n]}))];
    const nextTree=await api('git/trees','POST',{base_tree:commit.tree.sha,tree:entries}),nextCommit=await api('git/commits','POST',{message:'Studio : '+changes.length+' fichier(s) modifié(s) sur le PC',tree:nextTree.sha,parents:[parent]});
    await api('git/refs/heads/'+BRANCH,'PATCH',{sha:nextCommit.sha,force:false});
    // Edits made during the request remain dirty against this precise published snapshot.
    state.base=Object.fromEntries(Object.entries(snapshot.files).map(([n,x])=>[n,x.hash]));state.updated=snapshot.updated;state.etag=null;state.conflicts=[];last=snapshot;persist();emit('Tes changements sont publiés et accessibles à l’assistant.');
  }
  async function exclusive(fn){if(busy)throw Error('Une synchronisation est déjà en cours.');busy=true;emit();try{return await fn();}finally{busy=false;emit();}}
  async function tick(){if(stopped)return;try{if(state.enabled)await exclusive(async()=>{const r=applySnapshot(await publicSnapshot());if(token&&state.autoPublish&&!r.conflicts.length&&plan(local(),state.base,last).dirty.length)await publish();});}catch(e){emit(e.message);}finally{if(!stopped)timer=setTimeout(tick,token?20000:30000);}}
  async function command(action,p={}){
    if(action==='status')return status();
    if(action==='disconnect'){token='';if(fs.existsSync(secret))fs.unlinkSync(secret);state.autoPublish=false;persist();emit('Lecture des mises à jour active. Publication déconnectée.');return status();}
    if(action==='settings'){state.enabled=p.enabled===true;state.autoPublish=p.autoPublish===true&&!!token;persist();emit();return status();}
    if(action==='connect'){if(typeof p.token!=='string'||p.token.length<20||p.token.length>300||/\s/.test(p.token))throw Error('Autorisation GitHub invalide.');if(!safeStorage.isEncryptionAvailable())throw Error('Protection Windows du secret indisponible.');return exclusive(async()=>{const before=token;token=p.token;try{const repo=await api('');if(repo.full_name?.toLowerCase()!==REPO.toLowerCase())throw Error('Dépôt inattendu.');fs.mkdirSync(path.dirname(secret),{recursive:true});fs.writeFileSync(secret,safeStorage.encryptString(token));state.autoPublish=true;state.enabled=true;persist();emit('GitHub connecté. Publication automatique des fichiers de Studio activée.');return status();}catch(e){token=before;throw e;}});}
    if(action==='pull')return exclusive(async()=>{applySnapshot(await publicSnapshot());return status();});
    if(action==='publish')return exclusive(async()=>{await publish();return status();});
    if(action==='resolve'){if(!['local','remote'].includes(p.choice))throw Error('Choix invalide.');return exclusive(async()=>{state.etag=null;const snapshot=await publicSnapshot();applySnapshot(snapshot,p.choice);if(p.choice==='local'&&token)await publish();return status();});}
    throw Error('Commande inconnue.');
  }
  return {command,status,start:()=>{timer=setTimeout(tick,1500);},stop:()=>{stopped=true;clearTimeout(timer);},local,applySnapshot};
}
module.exports={create,plan,validate,digest,validName,REPO,BRANCH,REMOTE};
