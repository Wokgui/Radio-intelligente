(function(){
  const historyPageUndo=[];
  const historyPageRedo=[];

  function historySnapshot(){
    return JSON.stringify({music:S,sessionRejected});
  }

  function updateHistoryActions(){
    const undo=document.getElementById('historyPageUndo');
    const redo=document.getElementById('historyPageRedo');
    if(undo)undo.disabled=!historyPageUndo.length;
    if(redo)redo.disabled=!historyPageRedo.length;
  }

  function rememberHistoryAction(){
    historyPageUndo.push(historySnapshot());
    if(historyPageUndo.length>20)historyPageUndo.shift();
    historyPageRedo.length=0;
    updateHistoryActions();
  }

  function restoreHistorySnapshot(snapshot,message){
    const restored=JSON.parse(snapshot);
    S=norm(restored.music||{});
    sessionRejected=Array.isArray(restored.sessionRejected)?restored.sessionRejected:[];
    save(message);
    updateHistoryActions();
  }

  function undoHistoryAction(){
    if(!historyPageUndo.length)return;
    historyPageRedo.push(historySnapshot());
    restoreHistorySnapshot(historyPageUndo.pop(),'Dernière modification de Gardés annulée.');
  }

  function redoHistoryAction(){
    if(!historyPageRedo.length)return;
    historyPageUndo.push(historySnapshot());
    restoreHistorySnapshot(historyPageRedo.pop(),'Dernière modification de Gardés rétablie.');
  }

  function videoId(value){
    const raw=String(value||'').trim();
    if(/^[A-Za-z0-9_-]{11}$/.test(raw))return raw;
    try{
      const url=new URL(raw.startsWith('//')?'https:'+raw:/^https?:/i.test(raw)?raw:'https://'+raw);
      const host=url.hostname.toLowerCase().replace(/^www\./,'');
      const parts=url.pathname.split('/').filter(Boolean);
      let id='';
      if(host==='youtu.be')id=parts[0];
      if(host==='youtube.com'||host.endsWith('.youtube.com')||host==='youtube-nocookie.com'){
        if(url.pathname==='/watch')id=url.searchParams.get('v');
        else if(['shorts','embed','live','v'].includes(parts[0]))id=parts[1];
      }
      return /^[A-Za-z0-9_-]{11}$/.test(id||'')?id:'';
    }catch{return ''}
  }

  function canonicalUrl(value){
    const id=videoId(value);
    return id?'https://www.youtube.com/watch?v='+id:'';
  }

  function trackYoutubeUrl(track){
    return canonicalUrl(track?.youtubeUrl)||canonicalUrl(track?.externalUrl);
  }

  function trackSearchQuery(track){
    return ((track?.artist||'')+' '+(track?.title||'')).trim();
  }

  function youtubeLink(track){
    return trackYoutubeUrl(track)||'https://www.youtube.com/results?search_query='+encodeURIComponent(trackSearchQuery(track));
  }

  function rememberKept(){
    try{localStorage.setItem('radio-return-kept',String(Date.now()+60*60*1000))}catch{}
  }

  function restoreKept(){
    try{
      const until=Number(localStorage.getItem('radio-return-kept')||0);
      localStorage.removeItem('radio-return-kept');
      if(until<=Date.now())return;
      const page=document.getElementById('settingsPage');
      if(!page?.classList.contains('history-only')||tab!=='kept'){
        document.querySelector('.stats .stat')?.click();
      }
    }catch{}
  }

  window.addEventListener('pageshow',restoreKept);
  window.addEventListener('popstate',restoreKept);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)restoreKept()});

  function addKeptPlayer(row,track,youtube){
    const panel=document.createElement('div');
    panel.className='youtube-kept-controls';
    const play=document.createElement('button');
    play.type='button';
    play.className='row-link';
    play.textContent='Lire ici';
    const status=document.createElement('p');
    status.setAttribute('role','status');
    panel.append(play,status);
    row.appendChild(panel);
    play.onclick=()=>{
      const existing=document.querySelector('#hist .youtube-full-player');
      if(existing){
        const previous=existing.closest('.youtube-kept-controls');
        existing.remove();
        const previousButton=previous.querySelector('button');
        previousButton.textContent='Lire ici';
        previous.querySelector('[role="status"]').textContent='';
        if(previous===panel)return;
      }
      const id=videoId(trackYoutubeUrl(track));
      if(!id){
        status.textContent='Ce morceau n’a pas de lien direct. Utilise le bouton YouTube.';
        return;
      }
      youtube.href=canonicalUrl(id);
      const player=document.createElement('iframe');
      player.className='youtube-full-player';
      player.src='https://www.youtube-nocookie.com/embed/'+id+'?controls=1&playsinline=1&rel=0';
      player.title='Lecteur YouTube pour '+track.title;
      player.referrerPolicy='origin';
      player.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';
      player.allowFullscreen=true;
      panel.insertBefore(player,status);
      status.textContent='Si la vidéo est bloquée ici, utilise le bouton YouTube.';
      play.textContent='Fermer le lecteur';
    };
  }

  function firefoxUrl(value){
    const raw=String(value||'');
    if(!/Android/i.test(navigator.userAgent))return raw;
    try{
      const url=new URL(raw,location.href);
      if(!/^https?:$/.test(url.protocol))return raw;
      return 'intent://'+url.host+url.pathname+url.search+url.hash+
        '#Intent;scheme='+url.protocol.slice(0,-1)+';package=org.mozilla.firefox;S.browser_fallback_url='+encodeURIComponent(url.href)+';end';
    }catch{return raw}
  }

  function findTrack(date,key){
    return S.kept.find(track=>track.date===date&&Q(track)===key);
  }

  function setError(message){
    const error=document.getElementById('youtubeAddError');
    if(error)error.textContent=message||'';
  }

  function closeSheet(){
    const sheet=document.getElementById('youtubeAddSheet');
    if(sheet){
      sheet.classList.remove('open');
      sheet.setAttribute('aria-hidden','true');
    }
    setError('');
  }

  function updateAddAction(){
    const input=document.getElementById('youtubeAddInput');
    const confirm=document.getElementById('youtubeAddConfirm');
    if(!input||!confirm||confirm.disabled)return;
    const value=input.value.trim();
    confirm.textContent=value&&!videoId(value)?'Rechercher sur YouTube':'Ajouter';
  }

  function openSheet(){
    const sheet=document.getElementById('youtubeAddSheet');
    const title=document.getElementById('youtubeAddTitle');
    const note=document.getElementById('youtubeAddNote');
    const input=document.getElementById('youtubeAddInput');
    const confirm=document.getElementById('youtubeAddConfirm');
    const search=document.getElementById('youtubeSearchLink');
    if(!sheet||!title||!note||!input||!confirm||!search)return;
    title.textContent='Ajouter un morceau';
    note.textContent='Colle un lien YouTube pour ajouter le morceau, ou écris des mots-clés pour afficher les résultats YouTube.';
    confirm.textContent='Ajouter';
    search.classList.remove('visible');
    search.href='#';
    input.value='';
    input.placeholder='Lien YouTube ou artiste + titre';
    setError('');
    updateAddAction();
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden','false');
    setTimeout(()=>input.focus(),30);
  }

  async function submitSheet(){
    const input=document.getElementById('youtubeAddInput');
    const confirm=document.getElementById('youtubeAddConfirm');
    const raw=String(input?.value||'').trim();
    if(!raw){setError('Colle un lien YouTube ou écris des termes de recherche.');return}
    const url=canonicalUrl(raw);
    const id=videoId(url);
    if(!id){
      const search=document.getElementById('youtubeSearchLink');
      search.href=firefoxUrl('https://www.youtube.com/results?search_query='+encodeURIComponent(raw));
      search.click();
      setError('Résultats ouverts : choisis une vidéo, puis colle son lien ici pour l’ajouter.');
      return;
    }

    if(S.kept.some(track=>videoId(track.youtubeUrl||track.externalUrl)===id)){
      setError('Ce morceau est déjà dans Gardés.');
      return;
    }

    confirm.disabled=true;
    confirm.textContent='Ajout…';
    setError('');
    try{
      const track={
        id:'yt'+id,
        artist:'YouTube',
        title:'Morceau YouTube · '+id,
        album:'YouTube',
        cover:'/cover-default.png',
        preview:'',
        category:'youtube',
        source:'youtube-manual',
        externalUrl:url,
        youtubeUrl:url,
        date:new Date().toISOString(),
        signal:'keep'
      };
      rememberHistoryAction();
      S.kept.push(track);
      if(!S.seen.includes(Q(track)))S.seen.push(Q(track));
      save('Morceau YouTube ajouté dans Gardés.');
      closeSheet();
    }catch{
      setError('Impossible d’ajouter ce morceau pour le moment.');
    }finally{
      confirm.disabled=false;
      confirm.textContent='Ajouter';
    }
  }

  function decorateRows(){
    if(tab!=='kept')return;
    const rows=[...document.querySelectorAll('#hist .row:has(.row-main)')];
    rows.forEach(row=>{
      const cover=row.querySelector('.row-cover');
      if(cover?.src)row.style.setProperty('--row-cover','url("'+cover.src.replace(/"/g,'%22')+'")');
      const deleteButton=row.querySelector('.row-delete');
      const track=deleteButton&&findTrack(deleteButton.dataset.date,deleteButton.dataset.key);
      const actions=row.querySelector('.row-actions');
      if(!track||!actions||row.dataset.youtubeReady)return;
      row.dataset.youtubeReady='1';
      const youtube=actions.children[0];
      if(youtube?.tagName==='A'){
        youtube.href=youtubeLink(track);
        if(location.hostname==='app.local')youtube.removeAttribute('target');
        youtube.title='Ouvrir dans YouTube';
        youtube.addEventListener('click',rememberKept);
        addKeptPlayer(row,track,youtube);
      }
    });
  }

  function installTravelMode(settings){
    if(!settings||document.getElementById('radioTravelMode'))return;
    const button=document.createElement('button');
    button.type='button';
    button.id='radioTravelMode';
    const setMode=enabled=>{
      document.body.classList.toggle('radio-travel-mode',enabled);
      button.setAttribute('aria-pressed',String(enabled));
      button.textContent='Mode voiture / vélo : '+(enabled?'activé':'désactivé');
    };
    let enabled=false;
    try{enabled=localStorage.getItem('radio-travel-mode')==='1'}catch{}
    setMode(enabled);
    button.onclick=()=>{
      const next=!document.body.classList.contains('radio-travel-mode');
      setMode(next);
      try{localStorage.setItem('radio-travel-mode',next?'1':'0')}catch{}
    };
    settings.querySelector('.settings-head')?.after(button);
  }

  function install(){
    const settings=document.getElementById('settingsPage');
    const settingsHead=settings?.querySelector('.settings-head');
    installTravelMode(settings);
    restoreKept();
    if(settings&&settingsHead&&!document.getElementById('radioHistoryActions')){
      const actions=document.createElement('div');
      actions.id='radioHistoryActions';
      actions.className='radio-history-actions';
      actions.setAttribute('aria-label','Historique des modifications de Gardés et passés');
      actions.innerHTML='<button id="historyPageUndo" type="button" aria-label="Annuler la dernière modification"><span aria-hidden="true">↶</span><small>Annuler</small></button><button id="historyPageRedo" type="button" aria-label="Rétablir la dernière modification"><span aria-hidden="true">↷</span><small>Rétablir</small></button>';
      settingsHead.insertAdjacentElement('afterend',actions);
      document.getElementById('historyPageUndo').onclick=undoHistoryAction;
      document.getElementById('historyPageRedo').onclick=redoHistoryAction;
    }

    const baseRemoveKept=removeKept;
    removeKept=function(date,key){
      if(S.kept.some(track=>track.date===date&&Q(track)===key))rememberHistoryAction();
      return baseRemoveKept(date,key);
    };

    const tabs=document.querySelector('#settingsPage .radio-history-card .tabs');
    if(tabs&&!document.getElementById('addYoutubeTrack')){
      const add=document.createElement('button');
      add.type='button';
      add.id='addYoutubeTrack';
      add.className='history-add-tab';
      add.setAttribute('aria-label','Ajouter un morceau depuis YouTube');
      add.innerHTML='<span aria-hidden="true">＋</span><small>Ajouter</small>';
      add.onclick=openSheet;
      tabs.insertBefore(add,tabs.children[1]||null);
    }

    if(!document.getElementById('youtubeAddSheet')){
      const sheet=document.createElement('div');
      sheet.id='youtubeAddSheet';
      sheet.className='youtube-add-sheet';
      sheet.setAttribute('aria-hidden','true');
      sheet.innerHTML='<div class="youtube-add-dialog" role="dialog" aria-modal="true" aria-labelledby="youtubeAddTitle"><h3 id="youtubeAddTitle">Ajouter un morceau</h3><p id="youtubeAddNote"></p><a id="youtubeSearchLink" class="youtube-search-link" target="_blank" rel="noopener">Rechercher sur YouTube</a><input id="youtubeAddInput" type="search" inputmode="search" autocomplete="off" aria-label="Lien ou recherche YouTube"><div id="youtubeAddError" class="youtube-add-error" aria-live="polite"></div><div class="youtube-add-actions"><button id="youtubeAddCancel" type="button">Annuler</button><button id="youtubeAddConfirm" class="youtube-add-confirm" type="button">Ajouter</button></div></div>';
      document.body.appendChild(sheet);
      sheet.addEventListener('click',event=>{if(event.target===sheet)closeSheet()});
      document.getElementById('youtubeAddCancel').onclick=closeSheet;
      document.getElementById('youtubeAddConfirm').onclick=submitSheet;
      document.getElementById('youtubeAddInput').addEventListener('input',()=>{setError('');updateAddAction()});
      document.getElementById('youtubeAddInput').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();submitSheet()}});
      document.addEventListener('keydown',event=>{if(event.key==='Escape'&&sheet.classList.contains('open'))closeSheet()});
    }

    const baseRender=render;
    render=function(){
      const result=baseRender();
      decorateRows();
      updateHistoryActions();
      return result;
    };
    render();
  }

  install();
})();
