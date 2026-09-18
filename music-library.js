(function(){
  'use strict';

  const AUDIO_EXT=/\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|webm)$/i;
  const STATE_KEY='music_library_state_v1';
  const DEFAULT_COVER='/cover-default.png';
  const audio=document.getElementById('audio');
  const app=document.querySelector('main.app');
  const radioPage=document.getElementById('mainPage');
  if(!audio||!app||!radioPage)return;

  let tracks=[];
  let filtered=[];
  let currentIndex=-1;
  let section='tracks';
  let sourceObjectUrl='';
  let radioSnapshot=null;
  let musicSnapshot=null;
  let context='radio';
  let toastTimer=null;

  const state=loadState();

  function loadState(){
    try{
      const parsed=JSON.parse(localStorage.getItem(STATE_KEY)||'{}');
      return {
        favorites:Array.isArray(parsed.favorites)?parsed.favorites:[],
        playCounts:parsed.playCounts&&typeof parsed.playCounts==='object'?parsed.playCounts:{},
        recent:Array.isArray(parsed.recent)?parsed.recent:[],
        shuffle:!!parsed.shuffle,
        repeat:['off','all','one'].includes(parsed.repeat)?parsed.repeat:'off',
        lastTrackId:parsed.lastTrackId||'',
        lastTime:Number(parsed.lastTime||0),
        section:parsed.section||'tracks'
      };
    }catch{
      return {favorites:[],playCounts:{},recent:[],shuffle:false,repeat:'off',lastTrackId:'',lastTime:0,section:'tracks'};
    }
  }

  function saveState(){
    state.section=section;
    if(context==='music'&&currentIndex>=0&&tracks[currentIndex]){
      state.lastTrackId=tracks[currentIndex].id;
      state.lastTime=Number(audio.currentTime||0);
    }
    localStorage.setItem(STATE_KEY,JSON.stringify(state));
  }

  function esc(value){
    return String(value==null?'':value).replace(/[&<>"']/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function fmt(seconds){
    if(!Number.isFinite(seconds)||seconds<0)return '0:00';
    const m=Math.floor(seconds/60);
    const s=Math.floor(seconds%60);
    return m+':'+String(s).padStart(2,'0');
  }

  function toast(message){
    const el=document.getElementById('musicToast');
    if(!el)return;
    el.textContent=message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer=setTimeout(function(){el.classList.remove('show')},2200);
  }

  function makeShell(){
    const page=document.createElement('section');
    page.id='musicPage';
    page.className='music-tab-active';
    page.innerHTML=
      '<div class="music-topbar">'+
        '<button id="musicRescan" class="music-icon-btn" type="button" aria-label="Ajouter de la musique">＋</button>'+
        '<h1>Ma musique</h1>'+
        '<button id="musicSearchFocus" class="music-icon-btn" type="button" aria-label="Rechercher">⌕</button>'+
      '</div>'+
      '<section id="musicImportCard" class="music-import">'+
        '<strong>Ta bibliothèque musicale</strong>'+
        '<p>Choisis un dossier ou plusieurs fichiers. La lecture reste locale sur cet appareil.</p>'+
        '<div class="music-import-actions">'+
          '<button id="musicPickFolder" class="music-primary" type="button">Choisir un dossier</button>'+
          '<button id="musicPickFiles" class="music-secondary" type="button">Ajouter des fichiers</button>'+
        '</div>'+
        '<input id="musicFolderInput" type="file" accept="audio/*" multiple webkitdirectory hidden>'+
        '<input id="musicFilesInput" type="file" accept="audio/*" multiple hidden>'+
      '</section>'+
      '<section class="music-now" aria-label="Lecteur">'+
        '<img id="musicNowCover" class="music-now-cover" src="'+DEFAULT_COVER+'" alt="">'+
        '<div class="music-now-meta">'+
          '<span class="music-now-kicker">Lecture</span>'+
          '<div id="musicNowTitle" class="music-now-title">Aucun morceau</div>'+
          '<div id="musicNowArtist" class="music-now-artist">Choisis ta musique</div>'+
        '</div>'+
        '<div class="music-progress-row">'+
          '<span id="musicCurrentTime">0:00</span>'+
          '<input id="musicSeek" type="range" min="0" max="1000" value="0" aria-label="Position de lecture">'+
          '<span id="musicTotalTime">0:00</span>'+
        '</div>'+
        '<div class="music-controls">'+
          '<button id="musicShuffle" class="music-control" type="button" aria-label="Lecture aléatoire">⤨</button>'+
          '<button id="musicPrev" class="music-control" type="button" aria-label="Morceau précédent">‹‹</button>'+
          '<button id="musicPlay" class="music-control main" type="button" aria-label="Lecture ou pause">▶</button>'+
          '<button id="musicNext" class="music-control" type="button" aria-label="Morceau suivant">››</button>'+
          '<button id="musicRepeat" class="music-control" type="button" aria-label="Répétition">↻</button>'+
        '</div>'+
      '</section>'+
      '<nav class="music-section-tabs" aria-label="Bibliothèque">'+
        '<button class="music-section-tab active" data-music-section="tracks">Morceaux</button>'+
        '<button class="music-section-tab" data-music-section="albums">Albums</button>'+
        '<button class="music-section-tab" data-music-section="artists">Artistes</button>'+
        '<button class="music-section-tab" data-music-section="folders">Dossiers</button>'+
        '<button class="music-section-tab" data-music-section="favorites">Favoris</button>'+
        '<button class="music-section-tab" data-music-section="recent">Récents</button>'+
      '</nav>'+
      '<input id="musicSearch" class="music-search" type="search" autocomplete="off" placeholder="Rechercher un morceau, un artiste, un album">'+
      '<div id="musicSummary" class="music-summary"></div>'+
      '<div id="musicList" class="music-list"></div>';

    app.insertBefore(page,radioPage);
    radioPage.classList.add('music-tab-hidden');

    const nav=document.createElement('nav');
    nav.id='musicAppNav';
    nav.setAttribute('aria-label','Navigation principale');
    nav.innerHTML=
      '<button class="music-app-tab active" data-app-tab="music" type="button"><span>♫</span><span>Ma musique</span></button>'+
      '<button class="music-app-tab" data-app-tab="radio" type="button"><span>◉</span><span>Radio intelligente</span></button>';
    document.body.appendChild(nav);

    const toastEl=document.createElement('div');
    toastEl.id='musicToast';
    toastEl.className='music-toast';
    toastEl.setAttribute('aria-live','polite');
    document.body.appendChild(toastEl);

    document.body.classList.add('music-shell-ready');
  }

  function makeTrackId(file,path){
    return [path||file.webkitRelativePath||file.name,file.size,file.lastModified].join('|');
  }

  function pathInfo(file){
    const rel=file.webkitRelativePath||file.name;
    const parts=rel.split('/').filter(Boolean);
    const filename=parts.pop()||file.name;
    let album='';
    let artist='';
    if(parts.length>=2){
      album=parts[parts.length-1]||'';
      artist=parts[parts.length-2]||'';
    }else if(parts.length===1){
      artist=parts[0]||'';
    }
    return {path:rel,filename:filename,album:album,artist:artist,folder:parts.join('/')||'Fichiers'};
  }

  function decodeText(bytes,encoding){
    try{
      if(encoding===0)return new TextDecoder('iso-8859-1').decode(bytes).replace(/\0/g,'').trim();
      if(encoding===1){
        if(bytes[0]===0xff&&bytes[1]===0xfe)return new TextDecoder('utf-16le').decode(bytes.slice(2)).replace(/\0/g,'').trim();
        if(bytes[0]===0xfe&&bytes[1]===0xff){
          const swapped=new Uint8Array(bytes.length-2);
          for(let i=2;i+1<bytes.length;i+=2){swapped[i-2]=bytes[i+1];swapped[i-1]=bytes[i]}
          return new TextDecoder('utf-16le').decode(swapped).replace(/\0/g,'').trim();
        }
        return new TextDecoder('utf-16le').decode(bytes).replace(/\0/g,'').trim();
      }
      return new TextDecoder('utf-8').decode(bytes).replace(/\0/g,'').trim();
    }catch{return ''}
  }

  function syncSafe(b0,b1,b2,b3){
    return ((b0&127)<<21)|((b1&127)<<14)|((b2&127)<<7)|(b3&127);
  }

  async function readId3(file){
    const fallback={};
    try{
      const head=new Uint8Array(await file.slice(0,10).arrayBuffer());
      if(head.length<10||String.fromCharCode(head[0],head[1],head[2])!=='ID3')return fallback;
      const version=head[3];
      const tagSize=syncSafe(head[6],head[7],head[8],head[9]);
      const limit=Math.min(file.size,10+tagSize,2*1024*1024);
      const bytes=new Uint8Array(await file.slice(0,limit).arrayBuffer());
      let pos=10;
      while(pos+10<=bytes.length){
        const id=String.fromCharCode(bytes[pos],bytes[pos+1],bytes[pos+2],bytes[pos+3]);
        if(!/^[A-Z0-9]{4}$/.test(id))break;
        const size=version===4?syncSafe(bytes[pos+4],bytes[pos+5],bytes[pos+6],bytes[pos+7]):
          ((bytes[pos+4]<<24)>>>0)|(bytes[pos+5]<<16)|(bytes[pos+6]<<8)|bytes[pos+7];
        if(!size||pos+10+size>bytes.length)break;
        const data=bytes.slice(pos+10,pos+10+size);
        if(/^T/.test(id)&&data.length>1){
          const value=decodeText(data.slice(1),data[0]);
          if(id==='TIT2')fallback.title=value;
          else if(id==='TPE1')fallback.artist=value;
          else if(id==='TALB')fallback.album=value;
          else if(id==='TCON')fallback.genre=value;
          else if(id==='TRCK')fallback.trackNumber=value;
        }
        pos+=10+size;
      }
    }catch{}
    return fallback;
  }

  async function trackFromFile(file){
    const info=pathInfo(file);
    const tags=await readId3(file);
    const title=(tags.title||info.filename.replace(/\.[^.]+$/,'')).replace(/^\s*\d{1,3}\s*[-_. ]+\s*/,'').trim();
    return {
      id:makeTrackId(file,info.path),
      file:file,
      path:info.path,
      folder:info.folder,
      title:title||info.filename,
      artist:tags.artist||info.artist||'Artiste inconnu',
      album:tags.album||info.album||'Album inconnu',
      genre:tags.genre||'',
      trackNumber:tags.trackNumber||'',
      cover:DEFAULT_COVER
    };
  }

  async function addFiles(fileList){
    const files=Array.from(fileList||[]).filter(function(f){return (f.type&&f.type.indexOf('audio/')===0)||AUDIO_EXT.test(f.name)});
    if(!files.length){toast('Aucun fichier audio trouvé.');return}
    toast('Analyse de '+files.length+' fichier'+(files.length>1?'s':'')+'…');
    const existing=new Map(tracks.map(function(t){return [t.id,t]}));
    for(const file of files){
      const info=pathInfo(file);
      const id=makeTrackId(file,info.path);
      if(existing.has(id))continue;
      const track=await trackFromFile(file);
      tracks.push(track);
      existing.set(id,track);
    }
    tracks.sort(function(a,b){
      return (a.artist+' '+a.album+' '+a.title).localeCompare(b.artist+' '+b.album+' '+b.title,'fr',{sensitivity:'base',numeric:true});
    });
    filtered=tracks.slice();
    restoreLastTrackIndex();
    render();
    toast(tracks.length+' morceau'+(tracks.length>1?'x':'')+' disponible'+(tracks.length>1?'s':'')+'.');
  }

  function restoreLastTrackIndex(){
    if(currentIndex>=0&&tracks[currentIndex])return;
    if(state.lastTrackId){
      const i=tracks.findIndex(function(t){return t.id===state.lastTrackId});
      if(i>=0)currentIndex=i;
    }
  }

  function snapshotRadio(){
    return {
      src:audio.getAttribute('src')||'',
      time:Number(audio.currentTime||0),
      paused:audio.paused,
      title:document.getElementById('title')?.textContent||'',
      artist:document.getElementById('artist')?.textContent||'',
      cat:document.getElementById('cat')?.textContent||'',
      cover:document.getElementById('cover')?.getAttribute('src')||DEFAULT_COVER
    };
  }

  function snapshotMusic(){
    return {
      trackId:currentIndex>=0&&tracks[currentIndex]?tracks[currentIndex].id:'',
      time:Number(audio.currentTime||0),
      paused:audio.paused
    };
  }

  function restoreAudioSnapshot(snap,kind){
    audio.pause();
    if(sourceObjectUrl&&kind==='radio'){
      URL.revokeObjectURL(sourceObjectUrl);
      sourceObjectUrl='';
    }
    if(kind==='radio'){
      if(snap&&snap.src){
        audio.src=snap.src;
        audio.load();
        audio.addEventListener('loadedmetadata',function onMeta(){
          audio.removeEventListener('loadedmetadata',onMeta);
          try{audio.currentTime=Math.min(snap.time||0,Number.isFinite(audio.duration)?audio.duration:snap.time||0)}catch{}
          if(!snap.paused)audio.play().catch(function(){});
        });
      }else{
        audio.removeAttribute('src');
        audio.load();
      }
      const title=document.getElementById('title'),artist=document.getElementById('artist'),cat=document.getElementById('cat'),cover=document.getElementById('cover');
      if(title)title.textContent=snap?.title||'Radio intelligente';
      if(artist)artist.textContent=snap?.artist||'by myself';
      if(cat)cat.textContent=snap?.cat||'Prêt';
      if(cover)cover.src=snap?.cover||DEFAULT_COVER;
    }else{
      const wanted=snap?.trackId||state.lastTrackId;
      const i=tracks.findIndex(function(t){return t.id===wanted});
      if(i>=0)playTrack(i,{resumeTime:snap?.time||state.lastTime||0,autoplay:!snap?.paused});
    }
  }

  function setAppTab(tab){
    const music=tab==='music';
    if(music&&context==='radio'){
      radioSnapshot=snapshotRadio();
      musicSnapshot=musicSnapshot||{trackId:state.lastTrackId,time:state.lastTime,paused:true};
      context='music';
      if(musicSnapshot.trackId&&tracks.length)restoreAudioSnapshot(musicSnapshot,'music');
      else audio.pause();
    }else if(!music&&context==='music'){
      musicSnapshot=snapshotMusic();
      saveState();
      context='radio';
      restoreAudioSnapshot(radioSnapshot,'radio');
    }
    document.getElementById('musicPage')?.classList.toggle('music-tab-active',music);
    radioPage.classList.toggle('music-tab-hidden',music);
    document.querySelectorAll('.music-app-tab').forEach(function(btn){
      btn.classList.toggle('active',btn.dataset.appTab===tab);
    });
  }

  function releaseObjectUrl(){
    if(sourceObjectUrl){
      URL.revokeObjectURL(sourceObjectUrl);
      sourceObjectUrl='';
    }
  }

  function playTrack(index,options){
    options=options||{};
    if(index<0||index>=tracks.length)return;
    const track=tracks[index];
    currentIndex=index;
    context='music';
    releaseObjectUrl();
    sourceObjectUrl=URL.createObjectURL(track.file);
    audio.src=sourceObjectUrl;
    audio.load();
    updateNowPlaying();
    audio.addEventListener('loadedmetadata',function onMeta(){
      audio.removeEventListener('loadedmetadata',onMeta);
      if(options.resumeTime){
        try{audio.currentTime=Math.min(options.resumeTime,audio.duration||options.resumeTime)}catch{}
      }
      if(options.autoplay!==false)audio.play().catch(function(){});
      updatePlayerUi();
    });
    state.lastTrackId=track.id;
    state.lastTime=0;
    state.playCounts[track.id]=(state.playCounts[track.id]||0)+1;
    state.recent=[track.id].concat(state.recent.filter(function(id){return id!==track.id})).slice(0,100);
    saveState();
    updateMediaSession(track);
    render();
  }

  function nextIndex(direction){
    if(!tracks.length)return -1;
    if(state.shuffle&&tracks.length>1){
      let i=currentIndex;
      while(i===currentIndex)i=Math.floor(Math.random()*tracks.length);
      return i;
    }
    if(currentIndex<0)return direction<0?tracks.length-1:0;
    const i=currentIndex+direction;
    if(i>=0&&i<tracks.length)return i;
    if(state.repeat==='all')return direction>0?0:tracks.length-1;
    return -1;
  }

  function nextTrack(){
    const i=nextIndex(1);
    if(i>=0)playTrack(i);
    else audio.pause();
  }

  function prevTrack(){
    if(audio.currentTime>4){audio.currentTime=0;return}
    const i=nextIndex(-1);
    if(i>=0)playTrack(i);
  }

  function togglePlay(){
    if(currentIndex<0){
      if(tracks.length)playTrack(0);
      return;
    }
    if(!audio.getAttribute('src')){playTrack(currentIndex);return}
    if(audio.paused)audio.play().catch(function(){});
    else audio.pause();
  }

  function toggleFavorite(id){
    const i=state.favorites.indexOf(id);
    if(i>=0)state.favorites.splice(i,1);
    else state.favorites.unshift(id);
    saveState();
    render();
  }

  function currentTrack(){
    return currentIndex>=0?tracks[currentIndex]:null;
  }

  function updateNowPlaying(){
    const track=currentTrack();
    document.getElementById('musicNowTitle').textContent=track?track.title:'Aucun morceau';
    document.getElementById('musicNowArtist').textContent=track?(track.artist+(track.album&&track.album!=='Album inconnu'?' — '+track.album:'')):'Choisis ta musique';
    document.getElementById('musicNowCover').src=track?.cover||DEFAULT_COVER;
  }

  function updatePlayerUi(){
    if(context!=='music')return;
    const duration=Number(audio.duration||0);
    document.getElementById('musicCurrentTime').textContent=fmt(audio.currentTime||0);
    document.getElementById('musicTotalTime').textContent=fmt(duration);
    document.getElementById('musicSeek').value=duration>0?Math.round((audio.currentTime/duration)*1000):0;
    document.getElementById('musicPlay').textContent=audio.paused?'▶':'❚❚';
    document.getElementById('musicShuffle').classList.toggle('active',state.shuffle);
    const repeat=document.getElementById('musicRepeat');
    repeat.classList.toggle('active',state.repeat!=='off');
    repeat.textContent=state.repeat==='one'?'↻¹':'↻';
    repeat.title=state.repeat==='off'?'Répétition désactivée':state.repeat==='one'?'Répéter le morceau':'Répéter la bibliothèque';
  }

  function updateMediaSession(track){
    if(!('mediaSession' in navigator)||!track)return;
    try{
      navigator.mediaSession.metadata=new MediaMetadata({
        title:track.title,
        artist:track.artist,
        album:track.album,
        artwork:[{src:new URL(track.cover||DEFAULT_COVER,location.href).href}]
      });
    }catch{}
  }

  function groupBy(field,icon){
    const map=new Map();
    tracks.forEach(function(track){
      const key=track[field]||('Sans '+field);
      if(!map.has(key))map.set(key,[]);
      map.get(key).push(track);
    });
    return Array.from(map.entries()).sort(function(a,b){return a[0].localeCompare(b[0],'fr',{sensitivity:'base'})}).map(function(entry){
      const name=entry[0],items=entry[1];
      return '<div class="music-group">'+
        '<div class="music-group-icon">'+icon+'</div>'+
        '<button type="button" data-group-field="'+field+'" data-group-value="'+esc(name)+'">'+
          '<strong>'+esc(name)+'</strong><span>'+items.length+' morceau'+(items.length>1?'x':'')+'</span>'+
        '</button><span>›</span>'+
      '</div>';
    }).join('');
  }

  function visibleTracks(){
    const q=(document.getElementById('musicSearch')?.value||'').trim().toLocaleLowerCase('fr');
    let list=tracks.slice();
    if(section==='favorites')list=list.filter(function(t){return state.favorites.includes(t.id)});
    else if(section==='recent'){
      const order=new Map(state.recent.map(function(id,i){return [id,i]}));
      list=list.filter(function(t){return order.has(t.id)}).sort(function(a,b){return order.get(a.id)-order.get(b.id)});
    }
    if(q){
      list=list.filter(function(t){
        return (t.title+' '+t.artist+' '+t.album+' '+t.folder).toLocaleLowerCase('fr').includes(q);
      });
    }
    return list;
  }

  function renderTracks(list){
    const host=document.getElementById('musicList');
    if(!list.length){
      host.innerHTML='<div class="music-empty">'+(tracks.length?'Aucun morceau dans cette vue.':'Ajoute ton dossier musical pour commencer.')+'</div>';
      return;
    }
    host.innerHTML=list.map(function(track){
      const idx=tracks.indexOf(track);
      const fav=state.favorites.includes(track.id);
      return '<div class="music-row'+(idx===currentIndex?' playing':'')+'" data-track-index="'+idx+'">'+
        '<div class="music-row-cover">♫</div>'+
        '<button class="music-row-main" type="button" data-play-index="'+idx+'">'+
          '<span class="music-row-title">'+esc(track.title)+'</span>'+
          '<span class="music-row-sub">'+esc(track.artist)+' · '+esc(track.album)+'</span>'+
        '</button>'+
        '<button class="music-fav'+(fav?' active':'')+'" type="button" data-fav-id="'+esc(track.id)+'" aria-label="Favori">'+(fav?'★':'☆')+'</button>'+
      '</div>';
    }).join('');
  }

  function render(){
    if(!document.getElementById('musicPage'))return;
    document.querySelectorAll('.music-section-tab').forEach(function(btn){
      btn.classList.toggle('active',btn.dataset.musicSection===section);
    });
    const summary=document.getElementById('musicSummary');
    if(section==='albums'){
      summary.innerHTML='<strong>Albums</strong><span>'+new Set(tracks.map(function(t){return t.album})).size+' albums</span>';
      document.getElementById('musicList').innerHTML=groupBy('album','▣')||'<div class="music-empty">Aucun album.</div>';
    }else if(section==='artists'){
      summary.innerHTML='<strong>Artistes</strong><span>'+new Set(tracks.map(function(t){return t.artist})).size+' artistes</span>';
      document.getElementById('musicList').innerHTML=groupBy('artist','♬')||'<div class="music-empty">Aucun artiste.</div>';
    }else if(section==='folders'){
      summary.innerHTML='<strong>Dossiers</strong><span>'+new Set(tracks.map(function(t){return t.folder})).size+' dossiers</span>';
      document.getElementById('musicList').innerHTML=groupBy('folder','▰')||'<div class="music-empty">Aucun dossier.</div>';
    }else{
      const list=visibleTracks();
      const label=section==='favorites'?'Favoris':section==='recent'?'Récents':'Morceaux';
      summary.innerHTML='<strong>'+label+'</strong><span>'+list.length+' / '+tracks.length+'</span>';
      renderTracks(list);
    }
    document.getElementById('musicImportCard').hidden=tracks.length>0;
    updateNowPlaying();
    updatePlayerUi();
  }

  function openGroup(field,value){
    section='tracks';
    const search=document.getElementById('musicSearch');
    search.value=value;
    render();
    search.focus({preventScroll:true});
  }

  function bind(){
    document.querySelectorAll('.music-app-tab').forEach(function(btn){
      btn.addEventListener('click',function(){setAppTab(btn.dataset.appTab)});
    });
    document.getElementById('musicPickFolder').onclick=function(){document.getElementById('musicFolderInput').click()};
    document.getElementById('musicPickFiles').onclick=function(){document.getElementById('musicFilesInput').click()};
    document.getElementById('musicRescan').onclick=function(){document.getElementById('musicFolderInput').click()};
    document.getElementById('musicFolderInput').onchange=function(e){addFiles(e.target.files);e.target.value=''};
    document.getElementById('musicFilesInput').onchange=function(e){addFiles(e.target.files);e.target.value=''};
    document.getElementById('musicSearchFocus').onclick=function(){
      const el=document.getElementById('musicSearch');el.focus();el.scrollIntoView({behavior:'smooth',block:'center'});
    };
    document.getElementById('musicSearch').addEventListener('input',render);
    document.querySelector('.music-section-tabs').addEventListener('click',function(e){
      const btn=e.target.closest('[data-music-section]');
      if(!btn)return;
      section=btn.dataset.musicSection;
      document.getElementById('musicSearch').value='';
      render();
    });
    document.getElementById('musicList').addEventListener('click',function(e){
      const play=e.target.closest('[data-play-index]');
      if(play){playTrack(Number(play.dataset.playIndex));return}
      const fav=e.target.closest('[data-fav-id]');
      if(fav){toggleFavorite(fav.dataset.favId);return}
      const group=e.target.closest('[data-group-field]');
      if(group)openGroup(group.dataset.groupField,group.dataset.groupValue);
    });
    document.getElementById('musicPlay').onclick=togglePlay;
    document.getElementById('musicPrev').onclick=prevTrack;
    document.getElementById('musicNext').onclick=nextTrack;
    document.getElementById('musicShuffle').onclick=function(){state.shuffle=!state.shuffle;saveState();updatePlayerUi()};
    document.getElementById('musicRepeat').onclick=function(){
      state.repeat=state.repeat==='off'?'all':state.repeat==='all'?'one':'off';
      saveState();updatePlayerUi();
    };
    document.getElementById('musicSeek').addEventListener('input',function(e){
      if(context==='music'&&Number.isFinite(audio.duration)&&audio.duration>0){
        audio.currentTime=(Number(e.target.value)/1000)*audio.duration;
      }
    });

    audio.addEventListener('timeupdate',function(){
      if(context==='music'){
        state.lastTime=Number(audio.currentTime||0);
        updatePlayerUi();
      }
    });
    audio.addEventListener('play',updatePlayerUi);
    audio.addEventListener('pause',function(){updatePlayerUi();if(context==='music')saveState()});
    audio.addEventListener('loadedmetadata',updatePlayerUi);
    audio.addEventListener('ended',function(){
      if(context!=='music')return;
      if(state.repeat==='one'){audio.currentTime=0;audio.play().catch(function(){});return}
      nextTrack();
    });

    if('mediaSession' in navigator){
      try{
        navigator.mediaSession.setActionHandler('play',function(){if(context==='music')audio.play().catch(function(){})});
        navigator.mediaSession.setActionHandler('pause',function(){if(context==='music')audio.pause()});
        navigator.mediaSession.setActionHandler('previoustrack',function(){if(context==='music')prevTrack()});
        navigator.mediaSession.setActionHandler('nexttrack',function(){if(context==='music')nextTrack()});
        navigator.mediaSession.setActionHandler('seekto',function(details){
          if(context==='music'&&details.seekTime!=null)audio.currentTime=details.seekTime;
        });
      }catch{}
    }

    window.addEventListener('pagehide',saveState);
  }

  makeShell();
  section=state.section||'tracks';
  radioSnapshot=snapshotRadio();
  context='music';
  bind();
  render();
  setAppTab('music');
})();