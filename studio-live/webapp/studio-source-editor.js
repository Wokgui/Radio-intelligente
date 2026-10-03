(() => {
  const $=id=>document.getElementById(id), api=window.studioSource;
  let current=null,dirty=false,undo=null,busy=false;
  const status=text=>{$('status').textContent=text;};
  const buttons=()=>{$('save').disabled=busy||!dirty;$('undo').disabled=busy||!undo;for(const id of ['files','load','folder']) $(id).disabled=busy;};
  async function call(p){const result=await api.command(p);if(!result.ok)throw Error(result.error);return result;}
  function render(result){current=result;$('code').value=result.text;$('files').value=result.name;dirty=false;buttons();}
  function discard(){return !dirty||confirm('Abandonner les modifications non sauvegardées ?');}
  async function load(name){render(await call({action:'read',name}));status(name+' · fichier chargé.');}
  async function run(fn){if(busy)return;busy=true;buttons();try{await fn();}catch(error){status(error.message);}finally{busy=false;buttons();}}
  $('code').addEventListener('input',()=>{dirty=current&&$('code').value!==current.text;buttons();status(dirty?'Modifications non sauvegardées.':'Aucune modification.');});
  $('files').onchange=()=>{const name=$('files').value;if(!discard()){$('files').value=current.name;return;}run(()=>load(name));};
  $('load').onclick=()=>{if(discard())run(()=>load(current.name));};
  $('save').onclick=()=>run(async()=>{const result=await call({action:'write',name:current.name,text:$('code').value,hash:current.hash});undo=result.undo;render(result);status('Sauvegardé. Interface Studio se met à jour automatiquement.');});
  $('undo').onclick=()=>{if(discard())run(async()=>{const result=await call({action:'undo',id:undo});undo=null;render(result);status('Dernière sauvegarde annulée.');});};
  $('folder').onclick=()=>run(()=>call({action:'folder'}));
  window.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();if(!busy&&dirty)$('save').click();}});
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
  run(async()=>{const result=await call({action:'list'});for(const name of result.files){const option=document.createElement('option');option.value=name;option.textContent=name;$('files').append(option);}await load(result.files.includes('studio-workspace.css')?'studio-workspace.css':result.files[0]);});
})();
