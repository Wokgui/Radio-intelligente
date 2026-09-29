const { app, BrowserWindow, dialog, ipcMain, clipboard, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

let server;
let baseUrl = '';

const MIME = {
  '.html':'text/html; charset=utf-8',
  '.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.webmanifest':'application/manifest+json; charset=utf-8',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml',
  '.wav':'audio/wav'
};

function webRoot(){
  return app.isPackaged ? path.join(process.resourcesPath, 'webapp') : path.resolve(__dirname, '..');
}

async function proxyApi(req, res, pathname, search){
  try{
    const chunks=[];
    for await (const chunk of req) chunks.push(chunk);
    const body=chunks.length ? Buffer.concat(chunks) : undefined;
    const headers={...req.headers};
    delete headers.host;
    delete headers.origin;
    delete headers.referer;
    const remote=await fetch('https://radio-intelligente.vercel.app'+pathname+search,{
      method:req.method,
      headers,
      body:['GET','HEAD'].includes(req.method) ? undefined : body,
      redirect:'follow'
    });
    res.statusCode=remote.status;
    remote.headers.forEach((value,key)=>{
      if(!['content-encoding','transfer-encoding','connection'].includes(key.toLowerCase())){
        try{res.setHeader(key,value)}catch(_){}
      }
    });
    res.end(Buffer.from(await remote.arrayBuffer()));
  }catch(error){
    res.statusCode=502;
    res.setHeader('content-type','application/json; charset=utf-8');
    res.end(JSON.stringify({error:'Proxy API indisponible',detail:String(error&&error.message||error)}));
  }
}

function startServer(){
  return new Promise((resolve,reject)=>{
    const root=webRoot();
    server=http.createServer(async (req,res)=>{
      try{
        const url=new URL(req.url,'http://127.0.0.1');
        if(url.pathname.startsWith('/api/')){
          await proxyApi(req,res,url.pathname,url.search);
          return;
        }
        let pathname=decodeURIComponent(url.pathname);
        if(pathname==='/' || pathname==='') pathname='/index.html';
        const rootResolved=path.resolve(root);
        const candidate=path.resolve(root,'.'+pathname);
        if(!candidate.startsWith(rootResolved)){
          res.statusCode=403; res.end('Forbidden'); return;
        }
        let file=candidate;
        try{ if(fs.statSync(file).isDirectory()) file=path.join(file,'index.html'); }catch(_){}
        if(!fs.existsSync(file)){
          res.statusCode=404; res.end('Not found'); return;
        }
        const ext=path.extname(file).toLowerCase();
        res.statusCode=200;
        res.setHeader('content-type',MIME[ext]||'application/octet-stream');
        res.setHeader('cache-control','no-store');
        fs.createReadStream(file).pipe(res);
      }catch(error){
        res.statusCode=500;
        res.end(String(error&&error.message||error));
      }
    });
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      const address=server.address();
      baseUrl='http://127.0.0.1:'+address.port;
      resolve(baseUrl);
    });
  });
}

function projectPrompt(project){
  return [
    'Projet : Radio intelligente — modifications réalisées dans Radio Interface Studio.',
    '',
    'Applique ces modifications proprement dans le code source, sans empiler des rustines CSS. Préserve le responsive et les espaces volontaires. Un élément supprimé dans l’éditeur doit rester sans provoquer de remontée automatique sauf indication contraire.',
    '',
    'Données exactes du projet :',
    JSON.stringify(project,null,2)
  ].join('\n');
}

function createWindow(){
  const win=new BrowserWindow({
    width:1500,
    height:980,
    minWidth:1100,
    minHeight:720,
    backgroundColor:'#f3f0f7',
    title:'Radio Interface Studio',
    autoHideMenuBar:true,
    webPreferences:{
      preload:path.join(__dirname,'preload.cjs'),
      contextIsolation:true,
      nodeIntegration:false,
      sandbox:true
    }
  });
  win.loadURL(baseUrl+'/visual-editor.html?desktop=1');
  win.webContents.setWindowOpenHandler(({url})=>{
    if(/^https?:/i.test(url)) shell.openExternal(url);
    return {action:'deny'};
  });
}

ipcMain.handle('layout:save-project', async (_event, project)=>{
  const result=await dialog.showSaveDialog({
    title:'Enregistrer le projet d’interface',
    defaultPath:'radio-interface.radio-layout.json',
    filters:[{name:'Projet Radio Interface Studio',extensions:['json']},{name:'Tous les fichiers',extensions:['*']}]
  });
  if(result.canceled || !result.filePath) return {ok:false,canceled:true};
  fs.writeFileSync(result.filePath,JSON.stringify(project,null,2),'utf8');
  return {ok:true,path:result.filePath};
});

ipcMain.handle('layout:open-project', async ()=>{
  const result=await dialog.showOpenDialog({
    title:'Ouvrir un projet d’interface',
    properties:['openFile'],
    filters:[{name:'Projet Radio Interface Studio',extensions:['json']},{name:'Tous les fichiers',extensions:['*']}]
  });
  if(result.canceled || !result.filePaths[0]) return {ok:false,canceled:true};
  try{
    const project=JSON.parse(fs.readFileSync(result.filePaths[0],'utf8'));
    return {ok:true,path:result.filePaths[0],project};
  }catch(error){
    return {ok:false,error:'Fichier de projet invalide : '+String(error&&error.message||error)};
  }
});

ipcMain.handle('layout:save-chatgpt', async (_event, payload)=>{
  const project=payload&&payload.project ? payload.project : payload;
  const text=(payload&&payload.text) || projectPrompt(project);
  const result=await dialog.showSaveDialog({
    title:'Exporter pour ChatGPT',
    defaultPath:'radio-interface-pour-chatgpt.txt',
    filters:[{name:'Texte pour ChatGPT',extensions:['txt']},{name:'Markdown',extensions:['md']}]
  });
  if(result.canceled || !result.filePath) return {ok:false,canceled:true};
  fs.writeFileSync(result.filePath,text,'utf8');
  return {ok:true,path:result.filePath,text};
});

ipcMain.handle('layout:copy-text', (_event,text)=>{
  clipboard.writeText(String(text||''));
  return {ok:true};
});

ipcMain.handle('layout:app-info', ()=>({
  name:'Radio Interface Studio',
  version:app.getVersion(),
  packaged:app.isPackaged
}));

app.whenReady().then(async ()=>{
  await startServer();
  createWindow();
  app.on('activate',()=>{ if(BrowserWindow.getAllWindows().length===0) createWindow(); });
});

app.on('window-all-closed',()=>{
  if(server) server.close();
  if(process.platform!=='darwin') app.quit();
});
