const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Menu } = require('electron');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const editable = name => /^[a-z0-9][a-z0-9_.-]*\.(html|css|js|json)$/i.test(name) && !name.startsWith('studio-source-editor.');

function store(root, backupRoot) {
  const locate = name => {
    if (!editable(name)) throw Error('Choisir un fichier de la liste.');
    const file = path.join(root, name);
    if (fs.lstatSync(file).isSymbolicLink()) throw Error('Lien symbolique refusé.');
    if (fs.statSync(file).size > 2 * 1024 * 1024) throw Error('Fichier trop volumineux.');
    return file;
  };
  return {
    list: () => fs.readdirSync(root).filter(editable).filter(n => fs.lstatSync(path.join(root,n)).isFile()).sort(),
    read(name) { const text = fs.readFileSync(locate(name),'utf8'); return {name,text,hash:hash(text)}; },
    write(name, text, expected) {
      if (typeof text !== 'string' || Buffer.byteLength(text) > 2*1024*1024) throw Error('Contenu trop volumineux.');
      const file = locate(name), before = fs.readFileSync(file,'utf8');
      if (hash(before) !== expected) throw Error('Ce fichier a changé ailleurs. Recharge-le avant de sauvegarder.');
      fs.mkdirSync(backupRoot,{recursive:true});
      const id = crypto.randomUUID(), backup = path.join(backupRoot,id+'.json');
      fs.writeFileSync(backup,JSON.stringify({name,before,afterHash:hash(text)}));
      // Replace atomically so the live watcher never sees a partially written file.
      const temporary = file+'.'+id+'.tmp';
      try { fs.writeFileSync(temporary,text,'utf8'); fs.renameSync(temporary,file); }
      finally { if(fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      return {name,text,hash:hash(text),undo:id};
    },
    undo(id) {
      if(!/^[a-f0-9-]{36}$/.test(id)) throw Error('Sauvegarde invalide.');
      const file = path.join(backupRoot,id+'.json'), data = JSON.parse(fs.readFileSync(file,'utf8'));
      const result = this.write(data.name,data.before,data.afterHash);
      fs.unlinkSync(file);
      return result;
    }
  };
}

function install({app,BrowserWindow,ipcMain,dialog,shell,root,getWindows}) {
  const files = store(root,path.join(app.getPath('userData'),'studio-source-backups'));
  let editor, timer, enabled = true;
  const pending = new Set();
  function reload() {
    for(const win of getWindows()) if(!win.isDestroyed()) win.webContents.reload();
  }
  function changed(name) {
    if(!enabled || !editable(name)) return;
    pending.add(name); clearTimeout(timer);
    timer = setTimeout(() => {
      const names = [...pending]; pending.clear();
      const cssOnly = names.every(n=>n.endsWith('.css'));
      for(const win of getWindows()) {
        if(win.isDestroyed()) continue;
        if(cssOnly) {
          const script = `(() => {const names=${JSON.stringify(names)}; for(const link of document.querySelectorAll('link[rel="stylesheet"]')) {const u=new URL(link.href); if(names.includes(u.pathname.split('/').pop())) {u.searchParams.set('studioLive',Date.now()); link.href=u.href;}}})()`;
          win.webContents.executeJavaScript(script).catch(()=>{});
        } else win.webContents.reload();
      }
    },350);
  }
  const watcher = fs.watch(root,(_event,name)=>{if(name) changed(String(name));});
  watcher.on('error',error=>dialog.showErrorBox('Rechargement automatique',error.message));
  app.once('before-quit',()=>{watcher.close();clearTimeout(timer);});
  async function openEditor() {
    if(editor&&!editor.isDestroyed()) {editor.focus();return;}
    editor=new BrowserWindow({title:'Modifier Interface Studio · fichiers sources',width:1100,height:820,
      webPreferences:{preload:path.join(__dirname,'studio-source-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    editor.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    editor.webContents.on('will-navigate',event=>event.preventDefault());
    editor.on('closed',()=>{editor=null;});
    await editor.loadFile(path.join(root,'studio-source-editor.html'));
  }
  ipcMain.handle('studio-source:command',async(event,p)=>{
    if(!editor||event.sender!==editor.webContents||event.senderFrame!==editor.webContents.mainFrame) return {ok:false,error:'Origine refusée.'};
    try {
      let data;
      if(p?.action==='list') data={files:files.list()};
      else if(p?.action==='read') data=files.read(p.name);
      else if(p?.action==='write') data=files.write(p.name,p.text,p.hash);
      else if(p?.action==='undo') data=files.undo(p.id);
      else if(p?.action==='folder') {const error=await shell.openPath(root);if(error) throw Error(error);data={};}
      else throw Error('Commande inconnue.');
      return {ok:true,...data};
    } catch(error) {return {ok:false,error:error.message};}
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'Interface Studio',submenu:[{label:'Quitter',role:'quit'}]},
    {label:'Édition',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'Développement',submenu:[
      {label:'Modifier Interface Studio…',accelerator:'CmdOrCtrl+Shift+E',click:openEditor},
      {label:'Ouvrir les fichiers de l’interface',click:()=>shell.openPath(root)},
      {label:'Rechargement automatique',type:'checkbox',checked:true,click:item=>{enabled=item.checked;pending.clear();clearTimeout(timer);}},
      {label:'Recharger l’interface',accelerator:'CmdOrCtrl+R',click:reload},
      {label:'Inspecter l’interface',accelerator:'F12',click:()=>getWindows()[0]?.webContents.toggleDevTools()}
    ]}
  ]));
}
module.exports={store,editable,install};
