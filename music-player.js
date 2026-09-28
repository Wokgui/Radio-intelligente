(function(){
  'use strict';

  const MODE_KEY='radio_hugo_surface_v1';
  const STATE_KEY='radio_hugo_music_state_v1';
  const PLAYLISTS_KEY='radio_hugo_playlists_v1';
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
  let playlists=[];
  let librarySection='tracks';

  const defaultState={
    currentId:null,
    currentTime:0,
    shuffle:false,
    repeat:'off',
    sort:'recent',
    volume:1,
    activePlaylistId:null
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

  function loadPlaylists(){
    try{
      const raw=JSON.parse(localStorage.getItem(PLAYLISTS_KEY)||'[]');
      return Array.isArray(raw)?raw.filter(item=>item&&item.id&&item.name&&Array.isArray(item.trackIds)):[];
    }catch{
      return [];
    }
  }

  function savePlaylists(){
    try{localStorage.setItem(PLAYLISTS_KEY,JSON.stringify(playlists))}catch{}
  }

  function activePlaylist(){
    return playlists.find(item=>item.id===state.activePlaylistId)||null;
  }

  function playlistTracks(playlist){
    if(!playlist)return [];
    const map=new Map(tracks.map(track=>[track.id,track]));
    return playlist.trackIds.map(id=>map.get(id)).filter(Boolean);
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
    const playlist=activePlaylist();
    const baseTracks=playlist?playlistTracks(playlist):sortTracks(tracks);
    const ids=baseTracks.map(track=>track.id);
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
    if($('cat')){
      $('cat').textContent='';
      $('cat').classList.add('music-cat-hidden');
    }
    updateMusicStats();
    updateNextTrackLine();
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
      const playlist=activePlaylist();
      if(playlist){
        $('cat').textContent=playlist.name;
        $('cat').classList.remove('music-cat-hidden');
      }else{
        $('cat').textContent='';
        $('cat').classList.add('music-cat-hidden');
      }
    }
    updateMusicStats();
    updateNextTrackLine();
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

  function nextTrackCandidate(){
    if(!order.length)return null;
    let index=currentIndex+1;
    if(index>=order.length){
      if(state.repeat==='all')index=0;
      else return null;
    }
    return tracks.find(track=>track.id===order[index])||null;
  }

  function updateNextTrackLine(){
    const line=$('musicNextTrack');
    const text=$('musicNextTrackText');
    if(!line||!text)return;
    const next=nextTrackCandidate();
    if(next){
      line.hidden=false;
      text.textContent=(next.title||next.name||'Morceau')+(next.artist?' — '+next.artist:'');
    }else{
      line.hidden=false;
      text.textContent=order.length?'Fin de la liste':'Aucun morceau suivant';
    }
  }

  function switchPlaylist(direction){
    if(!playlists.length)return;
    let index=playlists.findIndex(item=>item.id===state.activePlaylistId);
    if(index<0)index=direction>0?-1:0;
    index=(index+direction+playlists.length)%playlists.length;
    const playlist=playlists[index];
    const valid=playlistTracks(playlist);
    if(!valid.length){
      setImportStatus('Cette liste de lecture est vide.');
      return;
    }
    state.activePlaylistId=playlist.id;
    rebuildOrder(valid[0].id);
    loadTrack(valid[0].id,{autoplay:true,resume:0});
    saveState();
    renderPlaylists();
  }

  function playPlaylist(id){
    const playlist=playlists.find(item=>item.id===id);
    const valid=playlistTracks(playlist);
    if(!playlist||!valid.length)return;
    state.activePlaylistId=playlist.id;
    rebuildOrder(valid[0].id);
    loadTrack(valid[0].id,{autoplay:true,resume:0});
    saveState();
    closeLibrary(false);
  }

  function createPlaylist(name){
    const value=String(name||prompt('Nom de la nouvelle liste de lecture :')||'').trim();
    if(!value)return null;
    const playlist={id:'pl_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),name:value,trackIds:[]};
    playlists.push(playlist);
    savePlaylists();
    renderPlaylists();
    return playlist;
  }

  function addTrackToPlaylist(trackId){
    if(!tracks.some(track=>track.id===trackId))return;
    if(!playlists.length){
      const created=createPlaylist();
      if(!created)return;
      created.trackIds.push(trackId);
      savePlaylists();
      renderPlaylists();
      return;
    }
    const menu=playlists.map((playlist,index)=>(index+1)+' — '+playlist.name).join('\n');
    const answer=prompt('Ajouter à quelle liste ?\n0 — Nouvelle liste\n'+menu);
    if(answer===null)return;
    const number=Number(answer);
    let playlist;
    if(number===0)playlist=createPlaylist();
    else playlist=playlists[number-1];
    if(!playlist)return;
    if(!playlist.trackIds.includes(trackId))playlist.trackIds.push(trackId);
    savePlaylists();
    renderPlaylists();
  }

  function deletePlaylist(id){
    const playlist=playlists.find(item=>item.id===id);
    if(!playlist)return;
    if(!confirm('Supprimer la liste « '+playlist.name+' » ? Les morceaux resteront dans Ma musique.'))return;
    playlists=playlists.filter(item=>item.id!==id);
    if(state.activePlaylistId===id){
      state.activePlaylistId=null;
      rebuildOrder(currentId);
      paintTrack(currentTrack());
      saveState();
    }
    savePlaylists();
    renderPlaylists();
  }

  function renderPlaylists(){
    const list=$('musicPlaylistsList');
    if(!list)return;
    if(!playlists.length){
      list.innerHTML='<div class="music-library-empty">Aucune liste de lecture.<br><small>Crée une liste puis ajoute des morceaux avec le bouton ＋.</small></div>';
      return;
    }
    list.innerHTML=playlists.map(playlist=>{
      const count=playlistTracks(playlist).length;
      return '<div class="music-playlist-row'+(playlist.id===state.activePlaylistId?' current':'')+'">'+
        '<button type="button" class="music-playlist-main" data-playlist-play="'+esc(playlist.id)+'">'+
          '<span class="music-row-note">☷</span><span class="music-row-text"><b>'+esc(playlist.name)+'</b><small>'+count+' morceau'+(count>1?'x':'')+'</small></span>'+
        '</button>'+
        '<button type="button" class="music-row-delete" data-playlist-delete="'+esc(playlist.id)+'" aria-label="Supprimer la liste">×</button>'+
      '</div>';
    }).join('');
  }

  function setLibrarySection(section){
    librarySection=section==='playlists'?'playlists':'tracks';
    const tracksPanel=$('musicTracksPanel');
    const playlistsPanel=$('musicPlaylistsPanel');
    if(tracksPanel)tracksPanel.hidden=librarySection!=='tracks';
    if(playlistsPanel)playlistsPanel.hidden=librarySection!=='playlists';
    document.querySelectorAll('#musicSectionTabs button').forEach(btn=>btn.classList.toggle('on',btn.dataset.section===librarySection));
    if(librarySection==='playlists')renderPlaylists();
    else renderLibrary();
  }

  function openPlaylists(){
    openLibrary();
    setLibrarySection('playlists');
  }

  function updateMusicStats(){
    if($('musicCount'))$('musicCount').textContent=tracks.length;
    if($('musicQueueLabel'))$('musicQueueLabel').textContent='Listes de lecture';
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
          '<button class="music-row-add" type="button" data-add-playlist-id="'+esc(track.id)+'" aria-label="Ajouter à une liste de lecture">＋</button>'+
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
    const settings=$('miniMore');
    if(settings){
      settings.hidden=isMusic;
      settings.style.display=isMusic?'none':'grid';
    }
    if(!isMusic){
      const radioQuick=document.querySelector('.track>.quick:not(.music-quick)');
      document.querySelectorAll('.track>.quick').forEach(el=>{
        if(el!==radioQuick){
          el.hidden=true;
          el.style.setProperty('display','none','important');
        }
      });
      const icons=radioQuick?radioQuick.querySelectorAll('.stat .sico'):[];
      if(icons[0])icons[0].innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="13" width="4" height="8" rx="1"></rect><rect x="10" y="8" width="4" height="13" rx="1"></rect><rect x="17" y="3" width="4" height="18" rx="1"></rect></svg>';
      if(icons[1])icons[1].innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5v14l7-7-7-7Zm8 0v14l7-7-7-7Z"></path><path d="M20 5h2v14h-2z"></path></svg>';
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
    const nav=$('radioMusicOpen');
    if(nav){
      const music=activeMode==='music';
      nav.setAttribute('aria-label',music?'Revenir à Radio intelligente':'Ouvrir Ma musique');
      nav.title=music?'Radio intelligente':'Ma musique';
      nav.dataset.target=music?'radio':'music';
      nav.innerHTML=music
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9a8 8 0 0 1 16 0"></path><path d="M7 9a5 5 0 0 1 10 0"></path><circle cx="12" cy="9" r="1.5"></circle><path d="M12 10.5V20"></path></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12"></path><circle cx="6" cy="18" r="3"></circle><circle cx="16" cy="16" r="3"></circle></svg>';
    }
  }

  function createDom(){
    const cover=document.querySelector('.player .cover');
    const track=document.querySelector('.player .track');
    if(!cover||!track||$('radioMusicOpen'))return;

    const radioBar=track.querySelector('.playerbar:not(.music-playerbar)');
    const shazamButton=$('miniPlay');
    const settingsButton=$('miniMore');
    if(radioBar){
      if(shazamButton)radioBar.insertBefore(shazamButton,radioBar.firstChild);
      if(settingsButton)radioBar.appendChild(settingsButton);
    }

    const radioQuick=track.querySelector('.quick:not(.music-quick)');
    const navButton=document.createElement('button');
    navButton.id='radioMusicOpen';
    navButton.className='radio-music-open';
    navButton.type='button';
    navButton.setAttribute('aria-label','Ouvrir Ma musique');
    navButton.title='Ma musique';
    navButton.dataset.target='music';
    navButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12"></path><circle cx="6" cy="18" r="3"></circle><circle cx="16" cy="16" r="3"></circle></svg>';
    if(radioQuick)radioQuick.insertAdjacentElement('afterend',navButton);

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
      '<button id="musicPlaylistPrev" class="icon-btn music-list-nav" type="button" aria-label="Liste de lecture précédente" title="Liste précédente">⏮☷</button>'+
      '<button id="musicMiniPrev" class="icon-btn" type="button" aria-label="Morceau précédent" title="Morceau précédent">⏮</button>'+
      '<span id="musicCt" class="time">0:00</span>'+
      '<div class="seek-wrap"><input id="musicSeek" class="seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="Position"></div>'+
      '<span id="musicTt" class="time">0:00</span>'+
      '<button id="musicMiniNext" class="icon-btn" type="button" aria-label="Morceau suivant" title="Morceau suivant">⏭</button>'+
      '<button id="musicPlaylistNext" class="icon-btn music-list-nav" type="button" aria-label="Liste de lecture suivante" title="Liste suivante">☷⏭</button>';
    track.appendChild(bar);

    const nextLine=document.createElement('div');
    nextLine.id='musicNextTrack';
    nextLine.className='music-next-track';
    nextLine.innerHTML='<span class="music-next-icon" aria-hidden="true">⏭</span><span class="music-next-label">Prochain morceau :</span><span id="musicNextTrackText" class="music-next-text">Aucun morceau suivant</span>';
    track.appendChild(nextLine);

    const settingsRow=document.createElement('div');
    settingsRow.id='musicSettingsRow';
    settingsRow.className='music-settings-row';
    settingsRow.innerHTML='<button id="musicSettingsGear" type="button" aria-label="Réglages de l\'application" title="Réglages">⚙</button>';
    track.appendChild(settingsRow);

    const actions=document.createElement('div');
    actions.id='musicActions';
    actions.className='alt music-alt';
    actions.innerHTML=
      '<button id="musicShuffle" type="button"><span class="ico">⇄</span><span class="txt">Lecture aléatoire</span></button>'+
      '<button id="musicRepeat" type="button"><span class="ico">↻</span><span class="txt">Répétition désactivée</span></button>';
    track.appendChild(actions);

    const quick=document.createElement('div');
    quick.id='musicQuick';
    quick.className='quick music-quick';
    quick.innerHTML=
      '<div class="stats">'+
        '<div class="stat" id="musicCountTile" role="button" tabindex="0"><span class="sico">♫</span><span class="meta"><b id="musicCount">0</b><span id="musicCountLabel">morceau</span></span></div>'+
        '<div class="divider"></div>'+
        '<button class="stat music-playlists-shortcut" id="musicQueueTile" type="button" aria-label="Ouvrir les listes de lecture"><span class="sico">☷</span><span class="meta"><b id="musicQueueLabel">Listes</b><span>de lecture</span></span></button>'+
      '</div>';
    track.appendChild(quick);

    const lessStyleIcon=document.querySelector('#lessStyle .ico');
    if(lessStyleIcon)lessStyleIcon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17V9"></path><path d="M9 20V5"></path><path d="M14 16V8"></path><path d="M19 13V11"></path><path d="M17 18h5"></path></svg>';
    const lessArtistIcon=document.querySelector('#lessArtist .ico');
    if(lessArtistIcon)lessArtistIcon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="8" r="3"></circle><path d="M4 20c0-4 2.5-7 6-7s6 3 6 7"></path><path d="M16 10h6"></path></svg>';

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
        '<div id="musicSectionTabs" class="music-section-tabs"><button type="button" data-section="tracks" class="on">Morceaux</button><button type="button" data-section="playlists">Listes de lecture</button></div>'+
        '<div id="musicTracksPanel">'+
          '<div class="music-import-actions"><button id="musicAddFiles" type="button">＋ Morceaux</button><button id="musicAddFolder" type="button">▣ Dossier</button></div>'+
          '<div id="musicImportStatus" class="music-import-status" aria-live="polite"></div>'+
          '<div class="music-search-row"><input id="musicSearch" type="search" autocomplete="off" placeholder="Rechercher un titre ou un artiste" aria-label="Rechercher"><select id="musicSort" aria-label="Trier"><option value="recent">Ajouts récents</option><option value="title">Titre</option><option value="artist">Artiste</option></select></div>'+
          '<div id="musicLibraryTabs" class="music-library-tabs"><button type="button" data-filter="all" class="on">Tout</button><button type="button" data-filter="favorites">Favoris</button></div>'+
          '<div id="musicStorageText" class="music-storage-text"></div>'+
          '<div id="musicLibraryList" class="music-library-list"></div>'+
        '</div>'+
        '<div id="musicPlaylistsPanel" hidden>'+
          '<div class="music-playlist-actions"><button id="musicCreatePlaylist" type="button">＋ Nouvelle liste</button></div>'+
          '<div id="musicPlaylistsList" class="music-playlists-list"></div>'+
        '</div>'+
      '</div>';
    document.body.appendChild(library);
  }

  function bindDom(){
    document.querySelectorAll('#experienceSwitch button').forEach(btn=>btn.addEventListener('click',()=>applyMode(btn.dataset.surface,true)));
    $('musicPrevCover').onclick=previousTrack;
    $('musicPlayCover').onclick=()=>togglePlay();
    $('musicPlaylistPrev').onclick=()=>switchPlaylist(-1);
    $('musicMiniPrev').onclick=previousTrack;
    $('musicMiniNext').onclick=()=>nextTrack(false);
    $('musicPlaylistNext').onclick=()=>switchPlaylist(1);
    $('musicShuffle').onclick=toggleShuffle;
    $('musicRepeat').onclick=cycleRepeat;
    $('musicSettingsGear').onclick=()=>{const gear=$('miniMore');if(gear)gear.click()};
    $('musicCountTile').onclick=()=>{openLibrary();setLibrarySection('tracks')};
    $('musicQueueTile').onclick=openPlaylists;
    $('radioMusicOpen').onclick=()=>applyMode($('radioMusicOpen').dataset.target||'music',true);
    $('musicCountTile').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openLibrary();setLibrarySection('tracks')}};
    $('musicLibraryBack').onclick=()=>closeLibrary(false);
    document.querySelectorAll('#musicSectionTabs button').forEach(btn=>btn.onclick=()=>setLibrarySection(btn.dataset.section));
    $('musicCreatePlaylist').onclick=()=>createPlaylist();
    $('musicPlaylistsList').addEventListener('click',event=>{
      const play=event.target.closest('[data-playlist-play]');
      if(play){playPlaylist(play.dataset.playlistPlay);return}
      const del=event.target.closest('[data-playlist-delete]');
      if(del){deletePlaylist(del.dataset.playlistDelete)}
    });
    $('musicAddFiles').onclick=()=>$('musicFileInput').click();
    $('musicAddFolder').onclick=()=>$('musicFolderInput').click();
    $('musicFileInput').onchange=event=>importFiles(event.target.files);
    $('musicFolderInput').onchange=event=>importFiles(event.target.files);
    $('musicSearch').oninput=renderLibrary;
    $('musicSort').onchange=event=>{state.sort=event.target.value;rebuildOrder(currentId);saveState();renderLibrary()};
    document.querySelectorAll('#musicLibraryTabs button').forEach(btn=>btn.onclick=()=>{filterMode=btn.dataset.filter;renderLibrary()});
    $('musicLibraryList').addEventListener('click',event=>{
      const play=event.target.closest('[data-play-id]');
      if(play){state.activePlaylistId=null;rebuildOrder(play.dataset.playId);loadTrack(play.dataset.playId,{autoplay:true,resume:0});saveState();closeLibrary(false);return}
      const add=event.target.closest('[data-add-playlist-id]');
      if(add){addTrackToPlaylist(add.dataset.addPlaylistId);return}
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
    playlists=loadPlaylists();
    try{
      tracks=await dbGetAll();
    }catch{
      setImportStatus('Le stockage local du navigateur est indisponible.');
      tracks=[];
    }
    if(state.activePlaylistId&&!playlists.some(item=>item.id===state.activePlaylistId))state.activePlaylistId=null;
    rebuildOrder(state.currentId);
    renderLibrary();
    renderPlaylists();
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