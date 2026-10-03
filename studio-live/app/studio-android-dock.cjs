const path=require('path');
function create({BrowserWindow,WebContentsView,ipcMain,shell,getWindow,getBaseUrl}) {
  let view=null,attached=false,loading=null;
  const proxy={get webContents(){return view?.webContents;},isDestroyed:()=>!view||view.webContents.isDestroyed(),focus:()=>view?.webContents.focus()};
  function detach(){const win=getWindow();if(attached&&win&&!win.isDestroyed())win.contentView.removeChildView(view);attached=false;}
  async function ensure(){
    if(view&&!view.webContents.isDestroyed()){await loading;return proxy;}
    const win=getWindow();
    view=new WebContentsView({webPreferences:{partition:'persist:ais-android-lab',preload:path.join(__dirname,'android-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    view.webContents.session.setPermissionRequestHandler((_w,p,callback)=>callback(p==='fullscreen'));
    view.webContents.setWindowOpenHandler(({url})=>{if(['https://developer.android.com/studio','https://developer.android.com/studio/run/emulator-acceleration'].includes(url))shell.openExternal(url);return {action:'deny'};});
    view.webContents.on('will-navigate',event=>event.preventDefault());
    win.once('closed',()=>{if(view&&!view.webContents.isDestroyed())view.webContents.close();view=null;attached=false;});
    loading=view.webContents.loadURL(getBaseUrl()+'/android-lab.html?embedded=1');
    try{await loading;}catch(error){view.webContents.close();view=null;throw error;}finally{loading=null;}
    return proxy;
  }
  ipcMain.handle('studio:android-dock',async(event,p={})=>{
    const win=getWindow();
    if(event.sender!==win?.webContents||event.senderFrame!==event.sender.mainFrame)return {ok:false,error:'Origine refusée.'};
    if(p.action==='hide'){detach();return {ok:true};}
    if(!['show','bounds'].includes(p.action))return {ok:false,error:'Commande inconnue.'};
    try{
      await ensure();const b=p.bounds,[width,height]=win.getContentSize();
      if(!b||!['x','y','width','height'].every(k=>Number.isFinite(b[k])))throw Error('Dimensions invalides.');
      const x=Math.max(0,Math.min(width,Math.round(b.x))),y=Math.max(0,Math.min(height,Math.round(b.y)));
      view.setBounds({x,y,width:Math.max(1,Math.min(width-x,Math.round(b.width))),height:Math.max(1,Math.min(height-y,Math.round(b.height)))});
      if(!attached){win.contentView.addChildView(view);attached=true;}
      return {ok:true};
    }catch(error){return {ok:false,error:error.message};}
  });
  ipcMain.handle('studio:android-return',event=>{
    if(event.sender!==view?.webContents||event.senderFrame!==event.sender.mainFrame)return {ok:false};
    detach();getWindow()?.webContents.send('studio:workspace-mode','edit');return {ok:true};
  });
  return {ensure,proxy,detach};
}
module.exports={create};
