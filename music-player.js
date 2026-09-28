(function(){
  'use strict';

  const MODE_KEY='radio_hugo_surface_v1';
  const STATE_KEY='radio_hugo_music_state_v1';
  const DB_NAME='radio-hugo-music-v1';
  const DB_VERSION=1;
  const STORE='tracks';
  const DEFAULT_COVER='/cover-default.png';

  const $=id=>document.getElementById(id);
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const fmtTime=value=>{
    if(!Number.isFinite(value)||value<0)return '0:00';
    const hours=Math.floor(value/3600);
    const minutes=Math.floor((value%3600)/60);
    const seconds=Math.floor(value%60).toString().padStart(2,'0');
    return hours?hours+':'+minutes.toString().padStart(2,'0')+':'+seconds:minutes+':'+seconds;
  };
  const isAudioFile=file=>{
    if(!file)return false;
    if(String(file.type||'').toLowerCase().startsWith('audio/'))return true;
    return /\.(mp3|m4a|aac|ogg|oga|wav|flac|opus|webm)$/i.test(file.name||'');
  };

  let dbPromise=null;
  let tracks=[];
  let order=[];
  let currentId=null;
  let currentIndex=-1;
  let radioSnapshot=null;
  let currentTrackUrl='';
  let currentArtUrl='';
  let pendingSeek=0;
  let saveClock=0;
  let libraryHistory=false;
  let activeMode='radio';
  let filterMode='all';
  let importBusy=false;

  const defaultState={
    currentId:null,
    currentTime:0,
    shuffle:false,
    repeat:'off',
    sort:'recent',
    volume:1
  };
  let state=loadState();

  function loadState(){
    try{
      const raw=JSON.parse(localStorage.getItem(STATE_KEY)||'null');
      return Object.assign({},defaultState,raw&&typeof raw==='object'?raw:{});
    }catch{
      return Object.assign({},defaultState);
    }
  }

  function saveState(){
    const audio=$('musicAudio');
    if(audio&&currentId===state.currentId&&Number.isFinite(audio.currentTime))state.currentTime=audio.currentTime;
    try{localStorage.setItem(STATE_KEY,JSON.stringify(state))}catch{}
  }

  function openDb(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      const request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains(STORE)){
          const store=db.createObjectStore(STORE,{keyPath:'id'});
          store.createIndex('addedAt','addedAt',{unique:false});
          store.createIndex('favorite','favorite',{unique:false});
        }
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('IndexedDB indisponible'));
    });
    return dbPromise;
  }

  async function dbGetAll(){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const request=db.transaction(STORE,'readonly').objectStore(STORE).getAll();
      request.onsuccess=()=>resolve(Array.isArray(request.result)?request.result:[]);
      request.onerror=()=>reject(request.error);
    });
  }

  async function dbPut(track){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const request=db.transaction(STORE,'readwrite').objectStore(STORE).put(track);
      request.onsuccess=()=>resolve();
      request.onerror=()=>reject(request.error);
    });
  }

  async function dbDelete(id){
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const request=db.transaction(STORE,'readwrite').objectStore(STORE).delete(id);
      request.onsuccess=()=>resolve();
      request.onerror=()=>reject(request.error);
    });
  }

  function stableId(file){
    return [file.name||'audio',file.size||0,file.lastModified||0,file.webkitRelativePath||''].join('::');
  }

  function filenameMetadata(file){
    let base=String(file.name||'Morceau').replace(/\.[^.]+$/,'').replace(/_/g,' ').trim();
    let artist='';
    let title=base||'Morceau';
    const parts=base.split(/\s+-\s+/);
    if(parts.length>1){
      artist=parts.shift().trim();
      title=parts.join(' - ').trim()||title;
    }
    return {title:title,artist:artist,album:'',artwork:null};
  }

  function synchsafe(bytes,offset){
    return ((bytes[offset]&0x7f)<<21)|((bytes[offset+1]&0x7f)<<14)|((bytes[offset+2]&0x7f)<<7)|(bytes[offset+3]&0x7f);
  }

  function uint32(bytes,offset){
    return ((bytes[offset]<<24)>>>0)+(bytes[offset+1]<<16)+(bytes[offset+2]<<8)+bytes[offset+3];
  }

  function decodeBytes(bytes,encoding){
    if(!bytes||!bytes.length)return '';
    let decoder;
    try{
      if(encoding===0)decoder=new TextDecoder('iso-8859-1');
      else if(encoding===1)decoder=new TextDecoder('utf-16');
      else if(encoding===2)decoder=new TextDecoder('utf-16be');
      else decoder=new TextDecoder('utf-8');
      return decoder.decode(bytes).replace(/\u0000/g,'').trim();
    }catch{
      return Array.from(bytes).map(v=>String.fromCharCode(v)).join('').replace(/\u0000/g,'').trim();
    }
  }

  function decodeTextFrame(data){
    if(!data||data.length<2)return '';
    return decodeBytes(data.subarray(1),data[0]);
  }

  function findTerminator(data,start,encoding){
    if(encoding===1||encoding===2){
      for(let i=start;i+1<data.length;i+=2){
        if(data[i]===0&&data[i+1]===0)return i+2;
      }
      return data.length;
    }
    for(let i=start;i<data.length;i++)if(data[i]===0)return i+1;
    return data.length;
  }

  function parseApic(data){
    if(!data||data.length<8)return null;
    const encoding=data[0];
    let p=1;
    let mimeEnd=p;
    while(mimeEnd<data.length&&data[mimeEnd]!==0)mimeEnd++;
    const mime=decodeBytes(data.subarray(p,mimeEnd),0)||'image/jpeg';
    p=mimeEnd+1;
    if(p>=data.length)return null;
    p++;
    p=findTerminator(data,p,encoding);
    if(p>=data.length)return null;
    const imageBytes=data.subarray(p);
    if(!imageBytes.length||imageBytes.length>3*1024*1024)return null;
    return new Blob([imageBytes],{type:mime.startsWith('image/')?mime:'image/jpeg'});
  }

  async function id3Metadata(file){
    if(!/\.mp3$/i.test(file.name||'')&&!/mpeg/i.test(file.type||''))return null;
    const header=new Uint8Array(await file.slice(0,10).arrayBuffer());
    if(header.length<10||header[0]!==73||header[1]!==68||header[2]!==51)return null;
    const version=header[3];
    if(version<3||version>4)return null;
    const tagSize=synchsafe(header,6);
    if(!tagSize)return null;
    const readSize=Math.min(file.size,10+tagSize,4*1024*1024);
    const bytes=new Uint8Array(await file.slice(0,readSize).arrayBuffer());
    let offset=10;
    const result={title:'',artist:'',album:'',artwork:null};
    while(offset+10<=bytes.length){
      const id=String.fromCharCode(bytes[offset],bytes[offset+1],bytes[offset+2],bytes[offset+3]);
      if(!/^[A-Z0-9]{4}$/.test(id))break;
      const size=version===4?synchsafe(bytes,offset+4):uint32(bytes,offset+4);
      if(!size||offset+10+size>bytes.length)break;
      const data=bytes.subarray(offset+10,offset+10+size);
      if(id==='TIT2')result.title=decodeTextFrame(data)||result.title;
      else if(id==='TPE1')result.artist=decodeTextFrame(data)||result.artist;
      else if(id==='TALB')result.album=decodeTextFrame(data)||result.album;
      else if(id==='APIC'&&!result.artwork)result.artwork=parseApic(data);
      offset+=10+size;
    }
    return result;
  }

  async function extractMetadata(file){
    const fallback=filenameMetadata(file);
    try{
      const id3=await id3Metadata(file);
      if(id3){
        return {
          title:id3.title||fallback.title,
          artist:id3.artist||fallback.artist,
          album:id3.album||fallback.album,
          artwork:id3.artwork||null
        };
      }
    }catch{}
    return fallback;
  }

  function sortTracks(list){
    const copy=list.slice();
    if(state.sort==='title'){
      copy.sort((a,b)=>(a.title||a.name).localeCompare(b.title||b.name,'fr',{sensitivity:'base'}));
    }else if(state.sort==='artist'){
      copy.sort((a,b)=>(a.artist||'').localeCompare(b.artist||'','fr',{sensitivity:'base'})||(a.title||a.name).localeCompare(b.title||b.name,'fr',{sensitivity:'base'}));
    }else{
      copy.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));
    }
    return copy;
  }

  function shuffled(list){
    const copy=list.slice();
    for(let i=copy.length-1;i>0;i--){
      const j=Math.floor(Math.random()*(i+1));
      const tmp=copy[i];
      copy[i]=copy[j];
      copy[j]=tmp;
    }
    return copy;
  }

  function rebuildOrder(anchorId){
    const ids=sortTracks(tracks).map(track=>track.id);
    const anchor=anchorId||currentId;
    if(state.shuffle&&ids.length){
      const rest=ids.filter(id=>id!==anchor);
      order=anchor&&ids.includes(anchor)?[anchor].concat(shuffled(rest)):shuffled(ids);
    }else{
      order=ids;
    }
    currentIndex=anchor?order.indexOf(anchor):-1;
  }

  function currentTrack(){
    return tracks.find(track=>track.id===currentId)||null;
  }

  function captureRadio(){
    radioSnapshot={
      cover:$('cover')?.getAttribute('src')||DEFAULT_COVER,
      title:$('title')?.textContent||'Radio intelligente',
      artist:$('artist')?.textContent||'',
      cat:$('cat')?.textContent||'Radio intelligente'
    };
  }

  function restoreRadio(){
    if(!radioSnapshot)return;
    if($('cover'))$('cover').src=radioSnapshot.cover||DEFAULT_COVER;
    if($('title'))$('title').textContent=radioSnapshot.title;
    if($('artist'))$('artist').textContent=radioSnapshot.artist;
    if($('cat'))$('cat').textContent=radioSnapshot.cat;
    try{if(typeof sync==='function')sync()}catch{}
  }

  function revokeUrls(){
    if(currentTrackUrl){URL.revokeObjectURL(currentTrackUrl);currentTrackUrl=''}
    if(currentArtUrl){URL.revokeObjectURL(currentArtUrl);currentArtUrl=''}
  }

  function paintEmpty(){
    if($('cover'))$('cover').src=DEFAULT_COVER;
    if($('title'))$('title').textContent='Ajoute ta musique';
    if($('artist'))$('artist').textContent='Tes fichiers restent stockés sur cet appareil';
    if($('cat'))$('cat').textContent='Ma musique';
    updateMusicStats();
  }

  function paintTrack(track){
    if(!track){paintEmpty();return}
    if(currentArtUrl){URL.revokeObjectURL(currentArtUrl);currentArtUrl=''}
    if(track.artwork){
      try{currentArtUrl=URL.createObjectURL(track.artwork)}catch{}
    }
    if($('cover'))$('cover').src=currentArtUrl||DEFAULT_COVER;
    if($('title'))$('title').textContent=track.title||track.name||'Morceau';
    if($('artist'))$('artist').textContent=[track.artist,track.album].filter(Boolean).join(' — ')||'Fichier local';
    if($('cat')){
      const pos=currentIndex>=0?currentIndex+1:1;
      $('cat').textContent='Ma musique • '+pos+'/'+Math.max(order.length,tracks.length);
    }
    updateMusicStats();
    updateMediaMetadata(track);
  }

  function loadTrack(id,options){
    const opts=Object.assign({autoplay:false,resume:0},options||{});
    const track=tracks.find(item=>item.id===id);
    if(!track)return;
    currentId=track.id;
    state.currentId=track.id;
    rebuildOrder(track.id);
    currentIndex=order.indexOf(track.id);
    const audio=$('musicAudio');
    if(!audio)return;

    const sameSource=audio.dataset.trackId===track.id&&!!audio.getAttribute('src');
    pendingSeek=Math.max(0,Number(opts.resume)||0);
    if(!sameSource){
      if(currentTrackUrl){URL.revokeObjectURL(currentTrackUrl);currentTrackUrl=''}
      currentTrackUrl=URL.createObjectURL(track.blob);
      audio.dataset.trackId=track.id;
      audio.src=currentTrackUrl;
      audio.load();
    }else if(Number.isFinite(audio.duration)&&pendingSeek>0){
      audio.currentTime=clamp(pendingSeek,0,Math.max(0,audio.duration-.1));
      pendingSeek=0;
    }

    state.currentTime=Number(opts.resume)||0;
    paintTrack(track);
    renderLibrary();
    saveState();

    if(opts.autoplay){
      const promise=audio.play();
      if(promise&&typeof promise.catch==='function')promise.catch(()=>{});
    }
  }

  function updateMusicStats(){
    if($('musicCount'))$('musicCount').textContent=tracks.length;
    if($('musicQueuePos')){
      const pos=currentIndex>=0?currentIndex+1:0;
      $('musicQueuePos').textContent=pos+'/'+Math.max(order.length,tracks.length);
    }
    if($('musicCountLabel'))$('musicCountLabel').textContent=tracks.length>1?'morceaux':'morceau';
    const track=currentTrack();
    if($('musicFavorite')){
      $('musicFavorite').classList.toggle('on',!!track?.favorite);
      const icon=$('musicFavorite').querySelector('.ico');
      const label=$('musicFavorite').querySelector('.txt');
      if(icon)icon.textContent=track?.favorite?'★':'☆';
      if(label)label.textContent=track?.favorite?'Favori':'Ajouter aux favoris';
      $('musicFavorite').disabled=!track;
    }
    if($('musicShuffle')){
      $('musicShuffle').classList.toggle('on',!!state.shuffle);
      const label=$('musicShuffle').querySelector('.txt');
      if(label)label.textContent=state.shuffle?'Aléatoire activé':'Lecture aléatoire';
    }
    if($('musicRepeat')){
      $('musicRepeat').classList.toggle('on',state.repeat!=='off');
      const label=$('musicRepeat').querySelector('.txt');
      if(label)label.textContent=state.repeat==='one'?'Répéter ce titre':state.repeat==='all'?'Répéter la file':'Répétition désactivée';
    }
  }

  function updatePlaybackUi(){
    const audio=$('musicAudio');
    if(!audio)return;
    const playing=!audio.paused&&!audio.ended;
    if($('musicPlayCover')){
      $('musicPlayCover').textContent=playing?'❚❚':'▶';
      $('musicPlayCover').setAttribute('aria-label',playing?'Pause':'Lecture');
    }
    if($('musicCt'))$('musicCt').textContent=fmtTime(audio.currentTime||0);
    if($('musicTt'))$('musicTt').textContent=fmtTime(audio.duration||0);
    if($('musicSeek')){
      const pct=Number.isFinite(audio.duration)&&audio.duration>0?((audio.currentTime||0)/audio.duration)*100:0;
      if(document.activeElement!==$('musicSeek'))$('musicSeek').value=String(pct);
    }
    if('mediaSession' in navigator){
      try{navigator.mediaSession.playbackState=playing?'playing':'paused'}catch{}
      updatePositionState();
    }
  }

  function updatePositionState(){
    const audio=$('musicAudio');
    if(!audio||activeMode!=='music'||!('mediaSession' in navigator))return;
    if(!Number.isFinite(audio.duration)||audio.duration<=0)return;
    try{
      navigator.mediaSession.setPositionState({
        duration:audio.duration,
        playbackRate:audio.playbackRate||1,
        position:clamp(audio.currentTime||0,0,Math.max(.01,audio.duration))
      });
    }catch{}
  }

  function updateMediaMetadata(track){
    if(activeMode!=='music'||!('mediaSession' in navigator)||!track)return;
    try{
      const artwork=currentArtUrl?[{src:currentArtUrl,sizes:'512x512'}]:[{src:location.origin+DEFAULT_COVER,sizes:'512x512',type:'image/png'}];
      navigator.mediaSession.metadata=new MediaMetadata({
        title:track.title||track.name||'Morceau',
        artist:track.artist||'Ma musique',
        album:track.album||'',
        artwork:artwork
      });
    }catch{}
  }

  function installMediaHandlers(){
    if(!('mediaSession' in navigator))return;
    const handlers={
      play:()=>togglePlay(),
      pause:()=>togglePlay(false),
      previoustrack:()=>previousTrack(),
      nexttrack:()=>nextTrack(false),
      seekbackward:details=>{
        const audio=$('musicAudio');
        if(audio)audio.currentTime=Math.max(0,audio.currentTime-(details.seekOffset||10));
      },
      seekforward:details=>{
        const audio=$('musicAudio');
        if(audio&&Number.isFinite(audio.duration))audio.currentTime=Math.min(audio.duration,audio.currentTime+(details.seekOffset||10));
      },
      seekto:details=>{
        const audio=$('musicAudio');
        if(audio&&Number.isFinite(details.seekTime))audio.currentTime=details.seekTime;
      }
    };
    Object.keys(handlers).forEach(action=>{
      try{navigator.mediaSession.setActionHandler(action,handlers[action])}catch{}
    });
    updateMediaMetadata(currentTrack());
  }

  function clearMediaHandlers(){
    if(!('mediaSession' in navigator))return;
    ['play','pause','previoustrack','nexttrack','seekbackward','seekforward','seekto'].forEach(action=>{
      try{navigator.mediaSession.setActionHandler(action,null)}catch{}
    });
    try{navigator.mediaSession.metadata=null}catch{}
  }

  function togglePlay(forcePlay){
    if(activeMode!=='music')return;
    const audio=$('musicAudio');
    if(!audio)return;
    if(!currentId){
      if(!tracks.length){openLibrary();return}
      const first=sortTracks(tracks)[0];
      loadTrack(first.id,{autoplay:true,resume:0});
      return;
    }
    const shouldPlay=forcePlay===true||(forcePlay!==false&&audio.paused);
    if(shouldPlay){
      const promise=audio.play();
      if(promise&&typeof promise.catch==='function')promise.catch(()=>{});
    }else{
      audio.pause();
    }
    updatePlaybackUi();
  }

  function nextTrack(fromEnded){
    if(!tracks.length)return;
    if(!order.length)rebuildOrder(currentId);
    let nextIndex=currentIndex+1;
    if(nextIndex>=order.length){
      if(fromEnded&&state.repeat==='off'){
        updatePlaybackUi();
        return;
      }
      nextIndex=0;
    }
    const nextId=order[nextIndex]||order[0];
    if(nextId)loadTrack(nextId,{autoplay:true,resume:0});
  }

  function previousTrack(){
    const audio=$('musicAudio');
    if(!tracks.length)return;
    if(audio&&audio.currentTime>5){
      audio.currentTime=0;
      updatePlaybackUi();
      return;
    }
    if(!order.length)rebuildOrder(currentId);
    let prevIndex=currentIndex-1;
    if(prevIndex<0)prevIndex=order.length-1;
    const prevId=order[prevIndex]||order[0];
    if(prevId)loadTrack(prevId,{autoplay:true,resume:0});
  }

  function toggleShuffle(){
    state.shuffle=!state.shuffle;
    rebuildOrder(currentId);
    saveState();
    updateMusicStats();
    renderLibrary();
  }

  function cycleRepeat(){
    state.repeat=state.repeat==='off'?'all':state.repeat==='all'?'one':'off';
    saveState();
    updateMusicStats();
  }

  async function toggleFavorite(id){
    const targetId=id||currentId;
    const track=tracks.find(item=>item.id===targetId);
    if(!track)return;
    track.favorite=!track.favorite;
    try{await dbPut(track)}catch{}
    renderLibrary();
    updateMusicStats();
  }

  function visibleTracks(){
    const query=String($('musicSearch')?.value||'').trim().toLocaleLowerCase('fr');
    return sortTracks(tracks).filter(track=>{
      if(filterMode==='favorites'&&!track.favorite)return false;
      if(!query)return true;
      const hay=[track.title,track.artist,track.album,track.name,track.path].filter(Boolean).join(' ').toLocaleLowerCase('fr');
      return hay.includes(query);
    });
  }

  function renderLibrary(){
    const list=$('musicLibraryList');
    if(!list)return;
    const rows=visibleTracks();
    if(!rows.length){
      list.innerHTML='<div class="music-library-empty">'+(tracks.length?'Aucun morceau ne correspond à cette recherche.':'Aucun morceau importé.<br><small>Ajoute des fichiers ou un dossier pour commencer.</small>')+'</div>';
    }else{
      list.innerHTML=rows.map(track=>{
        const info=[track.artist||'Artiste inconnu',track.album].filter(Boolean).join(' • ');
        return '<div class="music-library-row'+(track.id===currentId?' current':'')+'" data-id="'+esc(track.id)+'">'+
          '<button class="music-row-main" type="button" data-play-id="'+esc(track.id)+'">'+
            '<span class="music-row-note" aria-hidden="true">♫</span>'+
            '<span class="music-row-text"><b>'+esc(track.title||track.name||'Morceau')+'</b><small>'+esc(info)+'</small></span>'+
          '</button>'+
          '<button class="music-row-fav'+(track.favorite?' on':'')+'" type="button" data-fav-id="'+esc(track.id)+'" aria-label="'+(track.favorite?'Retirer des favoris':'Ajouter aux favoris')+'">'+(track.favorite?'★':'☆')+'</button>'+
          '<button class="music-row-delete" type="button" data-delete-id="'+esc(track.id)+'" aria-label="Retirer de Ma musique">×</button>'+
        '</div>';
      }).join('');
    }
    document.querySelectorAll('#musicLibraryTabs button').forEach(btn=>btn.classList.toggle('on',btn.dataset.filter===filterMode));
    if($('musicSort'))$('musicSort').value=state.sort;
    updateMusicStats();
    updateStorageText();
  }

  async function updateStorageText(){
    const status=$('musicStorageText');
    if(!status)return;
    let text=tracks.length+(tracks.length>1?' morceaux':' morceau');
    try{
      if(navigator.storage&&navigator.storage.estimate){
        const estimate=await navigator.storage.estimate();
        if(Number.isFinite(estimate.usage)){
          const mb=estimate.usage/1024/1024;
          text+=' • '+(mb>=1024?(mb/1024).toFixed(1)+' Go':Math.max(1,Math.round(mb))+' Mo')+' utilisés par l’app';
        }
      }
    }catch{}
    status.textContent=text;
  }

  async function deleteTrack(id){
    const track=tracks.find(item=>item.id===id);
    if(!track)return;
    if(!confirm('Retirer « '+(track.title||track.name||'ce morceau')+' » de Ma musique ? Le fichier original sur ton appareil ne sera pas supprimé.'))return;
    const wasCurrent=id===currentId;
    const oldIndex=currentIndex;
    try{await dbDelete(id)}catch{}
    tracks=tracks.filter(item=>item.id!==id);
    if(wasCurrent){
      const audio=$('musicAudio');
      if(audio){audio.pause();audio.removeAttribute('src');audio.load();delete audio.dataset.trackId}
      if(currentTrackUrl){URL.revokeObjectURL(currentTrackUrl);currentTrackUrl=''}
      currentId=null;
      state.currentId=null;
      state.currentTime=0;
    }
    rebuildOrder(currentId);
    if(wasCurrent&&tracks.length){
      const index=clamp(oldIndex,0,order.length-1);
      const replacement=order[index]||order[0];
      if(replacement)loadTrack(replacement,{autoplay:false,resume:0});
    }else if(!tracks.length){
      paintEmpty();
    }
    saveState();
    renderLibrary();
  }

  async function importFiles(fileList){
    if(importBusy)return;
    const files=Array.from(fileList||[]).filter(isAudioFile);
    if(!files.length){
      setImportStatus('Aucun fichier audio compatible sélectionné.');
      return;
    }
    importBusy=true;
    if(navigator.storage&&navigator.storage.persist){
      try{await navigator.storage.persist()}catch{}
    }
    const existing=new Set(tracks.map(track=>track.id));
    let added=0;
    let skipped=0;
    let failed=0;
    setImportStatus('Import de '+files.length+(files.length>1?' morceaux…':' morceau…'));
    for(let i=0;i<files.length;i++){
      const file=files[i];
      const id=stableId(file);
      if(existing.has(id)){skipped++;continue}
      try{
        const meta=await extractMetadata(file);
        const record={
          id:id,
          name:file.name,
          path:file.webkitRelativePath||file.name,
          type:file.type||'audio/*',
          size:file.size||0,
          lastModified:file.lastModified||0,
          addedAt:Date.now()+i,
          title:meta.title||file.name,
          artist:meta.artist||'',
          album:meta.album||'',
          artwork:meta.artwork||null,
          favorite:false,
          blob:file
        };
        await dbPut(record);
        tracks.push(record);
        existing.add(id);
        added++;
      }catch{
        failed++;
      }
      if(i%8===0)setImportStatus('Import '+(i+1)+'/'+files.length+'…');
    }
    rebuildOrder(currentId);
    renderLibrary();
    if(!currentId&&tracks.length){
      const first=sortTracks(tracks)[0];
      loadTrack(first.id,{autoplay:false,resume:0});
    }
    const bits=[added+' ajouté'+(added>1?'s':'')];
    if(skipped)bits.push(skipped+' déjà présent'+(skipped>1?'s':''));
    if(failed)bits.push(failed+' erreur'+(failed>1?'s':''));
    setImportStatus(bits.join(' • '));
    importBusy=false;
    if($('musicFileInput'))$('musicFileInput').value='';
    if($('musicFolderInput'))$('musicFolderInput').value='';
  }

  function setImportStatus(message){
    if($('musicImportStatus'))$('musicImportStatus').textContent=message||'';
  }

  function openLibrary(){
    if(!$('musicLibraryPage'))return;
    $('musicLibraryPage').classList.add('open');
    $('musicLibraryPage').setAttribute('aria-hidden','false');
    document.body.classList.add('music-library-open');
    renderLibrary();
    if(!libraryHistory){
      try{history.pushState({musicLibrary:true},'')}catch{}
      libraryHistory=true;
    }
  }

  function closeLibrary(fromPopstate){
    if(!$('musicLibraryPage'))return;
    $('musicLibraryPage').classList.remove('open');
    $('musicLibraryPage').setAttribute('aria-hidden','true');
    document.body.classList.remove('music-library-open');
    if(libraryHistory&&!fromPopstate){
      libraryHistory=false;
      try{history.back()}catch{}
    }else if(fromPopstate){
      libraryHistory=false;
    }
  }

  function setModeVisibility(mode){
    const isMusic=mode==='music';
    const radioOnly=[
      document.querySelector('.track>.primary'),
      document.querySelector('.track>.alt:not(.music-alt)'),
      document.querySelector('.track>.quick:not(.music-quick)')
    ].filter(Boolean);
    const musicOnly=[
      $('musicPlayerbar'),
      $('musicActions'),
      $('musicQuick'),
      $('musicPrevCover'),
      $('musicPlayCover')
    ].filter(Boolean);
    radioOnly.forEach(el=>{
      el.hidden=isMusic;
      el.style.display=isMusic?'none':'';
    });
    musicOnly.forEach(el=>{
      el.hidden=!isMusic;
      el.style.display=isMusic?'':'none';
    });
    const shazam=$('miniPlay');
    if(shazam){
      shazam.hidden=isMusic;
      shazam.style.display=isMusic?'none':'grid';
    }
  }

  function applyMode(mode,remember){
    const next=mode==='music'?'music':'radio';
    if(next===activeMode&&document.body.classList.contains(next==='music'?'music-mode':'radio-mode')){
      updateSwitch();
      return;
    }
    if(next==='music'){
      captureRadio();
      const radioAudio=$('audio');
      if(radioAudio&&!radioAudio.paused){radioAudio.pause();try{if(typeof sync==='function')sync()}catch{}}
      document.body.classList.add('music-mode');
      document.body.classList.remove('radio-mode');
      activeMode='music';
      setModeVisibility('music');
      installMediaHandlers();
      rebuildOrder(state.currentId);
      if(state.currentId&&tracks.some(track=>track.id===state.currentId)){
        if(currentId!==state.currentId||!$('musicAudio')?.getAttribute('src')){
          loadTrack(state.currentId,{autoplay:false,resume:Number(state.currentTime)||0});
        }else{
          currentId=state.currentId;
          currentIndex=order.indexOf(currentId);
          paintTrack(currentTrack());
          updatePlaybackUi();
        }
      }else if(tracks.length){
        const first=sortTracks(tracks)[0];
        loadTrack(first.id,{autoplay:false,resume:0});
      }else{
        paintEmpty();
      }
    }else{
      const musicAudio=$('musicAudio');
      if(musicAudio&&!musicAudio.paused)musicAudio.pause();
      saveState();
      clearMediaHandlers();
      if(document.body.classList.contains('music-library-open'))closeLibrary(false);
      document.body.classList.remove('music-mode');
      document.body.classList.add('radio-mode');
      activeMode='radio';
      setModeVisibility('radio');
      restoreRadio();
    }
    if(remember!==false){
      try{localStorage.setItem(MODE_KEY,next)}catch{}
    }
    updateSwitch();
  }

  function updateSwitch(){
    document.querySelectorAll('#experienceSwitch button').forEach(btn=>{
      const on=btn.dataset.surface===activeMode;
      btn.classList.toggle('on',on);
      btn.setAttribute('aria-selected',on?'true':'false');
    });
  }

  function createDom(){
    const cover=document.querySelector('.player .cover');
    const track=document.querySelector('.player .track');
    if(!cover||!track||$('experienceSwitch'))return;

    const switcher=document.createElement('div');
    switcher.id='experienceSwitch';
    switcher.className='experience-switch';
    switcher.setAttribute('role','tablist');
    switcher.setAttribute('aria-label','Choisir le lecteur');
    switcher.innerHTML=
      '<button type="button" role="tab" data-surface="music" aria-selected="false">Ma musique</button>'+
      '<button type="button" role="tab" data-surface="radio" aria-selected="true">Radio intelligente</button>';

    const experienceTools=document.createElement('div');
    experienceTools.id='experienceTools';
    experienceTools.className='experience-tools';
    experienceTools.appendChild(switcher);
    const shazamButton=$('miniPlay');
    if(shazamButton)experienceTools.appendChild(shazamButton);
    const settingsButton=$('miniMore');
    if(settingsButton)experienceTools.appendChild(settingsButton);

    const topLine=document.createElement('div');
    topLine.id='modeTopLine';
    topLine.className='mode-topline';
    const category=$('cat');
    if(category)topLine.appendChild(category);
    topLine.appendChild(experienceTools);
    track.insertBefore(topLine,track.firstChild);

    const prevCover=document.createElement('button');
    prevCover.id='musicPrevCover';
    prevCover.className='round music-cover-prev';
    prevCover.type='button';
    prevCover.setAttribute('aria-label','Morceau précédent');
    prevCover.textContent='⏮';
    cover.appendChild(prevCover);

    const playCover=document.createElement('button');
    playCover.id='musicPlayCover';
    playCover.className='round music-cover-play';
    playCover.type='button';
    playCover.setAttribute('aria-label','Lecture');
    playCover.textContent='▶';
    cover.appendChild(playCover);

    const bar=document.createElement('div');
    bar.id='musicPlayerbar';
    bar.className='playerbar music-playerbar';
    bar.setAttribute('aria-label','Lecteur de musique');
    bar.innerHTML=
      '<button id="musicMiniPrev" class="icon-btn" type="button" aria-label="Morceau précédent">⏮</button>'+
      '<span id="musicCt" class="time">0:00</span>'+
      '<div class="seek-wrap"><input id="musicSeek" class="seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="Position"></div>'+
      '<span id="musicTt" class="time">0:00</span>'+
      '<button id="musicMiniNext" class="icon-btn" type="button" aria-label="Morceau suivant">⏭</button>';
    track.appendChild(bar);

    const actions=document.createElement('div');
    actions.id='musicActions';
    actions.className='alt music-alt';
    actions.innerHTML=
      '<button id="musicShuffle" type="button"><span class="ico">⇄</span><span class="txt">Lecture aléatoire</span></button>'+
      '<button id="musicRepeat" type="button"><span class="ico">↻</span><span class="txt">Répétition désactivée</span></button>'+
      '<button id="musicFavorite" type="button"><span class="ico">☆</span><span class="txt">Ajouter aux favoris</span></button>'+
      '<button id="musicLibraryOpen" type="button"><span class="ico">☰</span><span class="txt">Bibliothèque</span></button>';
    track.appendChild(actions);

    const quick=document.createElement('div');
    quick.id='musicQuick';
    quick.className='quick music-quick';
    quick.innerHTML=
      '<div class="stats">'+
        '<div class="stat" id="musicCountTile" role="button" tabindex="0"><span class="sico">♫</span><span class="meta"><b id="musicCount">0</b><span id="musicCountLabel">morceau</span></span></div>'+
        '<div class="divider"></div>'+
        '<div class="stat" id="musicQueueTile" role="button" tabindex="0"><span class="sico">☷</span><span class="meta"><b id="musicQueuePos">0/0</b><span>file</span></span></div>'+
      '</div>';
    track.appendChild(quick);

    const audio=document.createElement('audio');
    audio.id='musicAudio';
    audio.preload='metadata';
    audio.setAttribute('playsinline','');
    document.body.appendChild(audio);

    const fileInput=document.createElement('input');
    fileInput.id='musicFileInput';
    fileInput.type='file';
    fileInput.accept='audio/*,.mp3,.m4a,.aac,.ogg,.oga,.wav,.flac,.opus,.webm';
    fileInput.multiple=true;
    fileInput.hidden=true;
    document.body.appendChild(fileInput);

    const folderInput=document.createElement('input');
    folderInput.id='musicFolderInput';
    folderInput.type='file';
    folderInput.accept='audio/*,.mp3,.m4a,.aac,.ogg,.oga,.wav,.flac,.opus,.webm';
    folderInput.multiple=true;
    folderInput.hidden=true;
    folderInput.setAttribute('webkitdirectory','');
    folderInput.setAttribute('directory','');
    document.body.appendChild(folderInput);

    const library=document.createElement('section');
    library.id='musicLibraryPage';
    library.className='music-library-page';
    library.setAttribute('aria-hidden','true');
    library.innerHTML=
      '<div class="music-library-head"><button id="musicLibraryBack" type="button" aria-label="Retour">‹</button><h2>Ma musique</h2><span></span></div>'+
      '<div class="music-library-body">'+
        '<div class="music-import-actions"><button id="musicAddFiles" type="button">＋ Morceaux</button><button id="musicAddFolder" type="button">▣ Dossier</button></div>'+
        '<div id="musicImportStatus" class="music-import-status" aria-live="polite"></div>'+
        '<div class="music-search-row"><input id="musicSearch" type="search" autocomplete="off" placeholder="Rechercher un titre ou un artiste" aria-label="Rechercher"><select id="musicSort" aria-label="Trier"><option value="recent">Ajouts récents</option><option value="title">Titre</option><option value="artist">Artiste</option></select></div>'+
        '<div id="musicLibraryTabs" class="music-library-tabs"><button type="button" data-filter="all" class="on">Tout</button><button type="button" data-filter="favorites">Favoris</button></div>'+
        '<div id="musicStorageText" class="music-storage-text"></div>'+
        '<div id="musicLibraryList" class="music-library-list"></div>'+
      '</div>';
    document.body.appendChild(library);
  }

  function bindDom(){
    document.querySelectorAll('#experienceSwitch button').forEach(btn=>btn.addEventListener('click',()=>applyMode(btn.dataset.surface,true)));
    $('musicPrevCover').onclick=previousTrack;
    $('musicPlayCover').onclick=()=>togglePlay();
    $('musicMiniPrev').onclick=previousTrack;
    $('musicMiniNext').onclick=()=>nextTrack(false);
    $('musicShuffle').onclick=toggleShuffle;
    $('musicRepeat').onclick=cycleRepeat;
    $('musicFavorite').onclick=()=>toggleFavorite();
    $('musicLibraryOpen').onclick=openLibrary;
    $('musicCountTile').onclick=openLibrary;
    $('musicQueueTile').onclick=openLibrary;
    $('musicCountTile').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openLibrary()}};
    $('musicQueueTile').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openLibrary()}};
    $('musicLibraryBack').onclick=()=>closeLibrary(false);
    $('musicAddFiles').onclick=()=>$('musicFileInput').click();
    $('musicAddFolder').onclick=()=>$('musicFolderInput').click();
    $('musicFileInput').onchange=event=>importFiles(event.target.files);
    $('musicFolderInput').onchange=event=>importFiles(event.target.files);
    $('musicSearch').oninput=renderLibrary;
    $('musicSort').onchange=event=>{state.sort=event.target.value;rebuildOrder(currentId);saveState();renderLibrary()};
    document.querySelectorAll('#musicLibraryTabs button').forEach(btn=>btn.onclick=()=>{filterMode=btn.dataset.filter;renderLibrary()});
    $('musicLibraryList').addEventListener('click',event=>{
      const play=event.target.closest('[data-play-id]');
      if(play){loadTrack(play.dataset.playId,{autoplay:true,resume:0});closeLibrary(false);return}
      const fav=event.target.closest('[data-fav-id]');
      if(fav){toggleFavorite(fav.dataset.favId);return}
      const del=event.target.closest('[data-delete-id]');
      if(del){deleteTrack(del.dataset.deleteId)}
    });

    $('musicSeek').addEventListener('input',event=>{
      const audio=$('musicAudio');
      if(audio&&Number.isFinite(audio.duration)&&audio.duration>0){
        audio.currentTime=(Number(event.target.value)/100)*audio.duration;
        updatePlaybackUi();
      }
    });

    const audio=$('musicAudio');
    audio.volume=clamp(Number(state.volume)||1,0,1);
    audio.addEventListener('loadedmetadata',()=>{
      if(pendingSeek>0&&Number.isFinite(audio.duration)){
        audio.currentTime=clamp(pendingSeek,0,Math.max(0,audio.duration-.1));
        pendingSeek=0;
      }
      updatePlaybackUi();
    });
    audio.addEventListener('timeupdate',()=>{
      updatePlaybackUi();
      const now=Date.now();
      if(now-saveClock>4000){saveClock=now;saveState()}
    });
    audio.addEventListener('play',updatePlaybackUi);
    audio.addEventListener('pause',()=>{saveState();updatePlaybackUi()});
    audio.addEventListener('durationchange',updatePlaybackUi);
    audio.addEventListener('volumechange',()=>{state.volume=audio.volume;saveState();updatePlaybackUi()});
    audio.addEventListener('ended',()=>{
      if(state.repeat==='one'){
        audio.currentTime=0;
        const promise=audio.play();
        if(promise&&typeof promise.catch==='function')promise.catch(()=>{});
      }else{
        nextTrack(true);
      }
    });
    audio.addEventListener('error',()=>{if(activeMode==='music')setImportStatus('Impossible de lire ce fichier. Essaie un autre format.')});

    window.addEventListener('pagehide',saveState);
    window.addEventListener('beforeunload',saveState);
    window.addEventListener('popstate',()=>{
      if(document.body.classList.contains('music-library-open'))closeLibrary(true);
    });
  }

  async function init(){
    createDom();
    bindDom();
    document.body.classList.add('radio-mode');
    try{
      tracks=await dbGetAll();
    }catch{
      setImportStatus('Le stockage local du navigateur est indisponible.');
      tracks=[];
    }
    rebuildOrder(state.currentId);
    renderLibrary();
    const savedMode=localStorage.getItem(MODE_KEY)==='music'?'music':'radio';
    if(savedMode==='music'){
      applyMode('music',false);
    }else{
      activeMode='radio';
      document.body.classList.add('radio-mode');
      document.body.classList.remove('music-mode');
      setModeVisibility('radio');
      updateSwitch();
    }
    updateMusicStats();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();