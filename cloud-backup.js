(function () {
  'use strict';

  const SUPABASE_URL = 'https://oxdrhwveuctrorrkuurw.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94ZHJod3ZldWN0cm9ycmt1dXJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2MjYzNDQsImV4cCI6MjEwMTIwMjM0NH0.lrdF-JILpgAwSrMLVjeU0fcKd2anOhp_T0qtEtJTVc0';

  function create(options) {
    if (!window.supabase?.createClient) return;
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true }
    });
    let user = null;
    let busy = false;
    let applying = false;
    let timer = null;

    const style = document.createElement('style');
    style.textContent = '.cloud-backup-button{position:fixed;right:14px;bottom:calc(56px + env(safe-area-inset-bottom));z-index:9998;border:0;border-radius:999px;padding:11px 16px;background:#173b32;color:#fff;font:700 14px system-ui;box-shadow:0 6px 22px #0004}.cloud-backup-panel{position:fixed;inset:0;z-index:9999;background:#0008;display:grid;place-items:center;padding:16px}.cloud-backup-card{width:min(520px,100%);max-height:88vh;overflow:auto;background:#fff;color:#17221f;border-radius:18px;padding:20px;font:15px/1.4 system-ui;box-shadow:0 20px 60px #0008}.cloud-backup-card h2{margin:0 0 8px}.cloud-backup-card input,.cloud-backup-card button,.cloud-backup-card select{box-sizing:border-box;width:100%;margin-top:9px;padding:11px;border:1px solid #bcc9c5;border-radius:10px;font:inherit}.cloud-backup-card button{background:#173b32;color:#fff;font-weight:700}.cloud-backup-card button.secondary{background:#eef3f1;color:#173b32}.cloud-backup-close{float:right;width:auto!important;margin:0!important;padding:5px 9px!important}.cloud-backup-status{padding:9px 0;color:#36544b}.cloud-backup-note{font-size:13px;color:#52655f}.cloud-backup-history{margin:10px 0 0;padding:0;list-style:none}.cloud-backup-history li{display:flex;gap:8px;align-items:center;justify-content:space-between;border-top:1px solid #e2e8e6;padding:8px 0}.cloud-backup-history-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap}.cloud-backup-history button{width:auto;margin:0;padding:7px 9px}.cloud-backup-history a{display:inline-block;margin:0;padding:7px 9px;border:1px solid #bcc9c5;border-radius:10px;background:#eef3f1;color:#173b32;font-weight:700;text-decoration:none;white-space:nowrap}.cloud-backup-history small{color:#65736f}.cloud-backup-hidden{display:none!important}';
    document.head.appendChild(style);

    let button = options.triggerElement || (options.triggerSelector && document.querySelector(options.triggerSelector));
    if (button && options.replaceTrigger) {
      const replacement = button.cloneNode(true);
      button.replaceWith(replacement);
      button = replacement;
    }
    if (!button) {
      button = document.createElement('button');
      button.className = 'cloud-backup-button';
      button.textContent = '☁ Sauvegarde';
      button.type = 'button';
      document.body.appendChild(button);
    }
    if (options.triggerAriaLabel) button.setAttribute('aria-label', options.triggerAriaLabel);

    const panel = document.createElement('div');
    panel.className = 'cloud-backup-panel cloud-backup-hidden';
    panel.innerHTML = '<div class="cloud-backup-card"><button class="cloud-backup-close secondary" type="button" aria-label="Fermer">✕</button><h2>Sauvegardes automatiques</h2><div class="cloud-backup-status">Vérification…</div><div class="cloud-backup-auth"><p>Utilisez la même adresse et le même mot de passe dans les trois applications. Cette connexion n’est à faire qu’une fois par appareil.</p><input class="cloud-backup-email" type="email" inputmode="email" autocomplete="email" placeholder="votre@email.fr"><input class="cloud-backup-password" type="password" autocomplete="current-password" minlength="6" placeholder="Mot de passe (6 caractères minimum)"><button class="cloud-backup-login" type="button">Se connecter</button><button class="cloud-backup-signup secondary" type="button">Créer mon accès de sauvegarde</button></div><div class="cloud-backup-tools cloud-backup-hidden"><button class="cloud-backup-now" type="button">Sauvegarder maintenant</button><button class="cloud-backup-download secondary" type="button">Télécharger les données actuelles</button><button class="cloud-backup-download-all secondary" type="button">Télécharger les 20 dernières versions</button><h3>20 dernières versions — données + ZIP du site</h3><ul class="cloud-backup-history"></ul><button class="cloud-backup-logout secondary" type="button">Déconnecter cet appareil</button></div><p class="cloud-backup-note">Chaque nouvelle sauvegarde est liée au ZIP exact du site publié. Une restauration crée une nouvelle version : rien n’est écrasé sans laisser de trace.</p></div>';
    document.body.appendChild(panel);

    const $ = (selector) => panel.querySelector(selector);
    const status = (message) => { $('.cloud-backup-status').textContent = message; options.onStatus?.(message); };
    const migratedKey = (uid) => `cloud_backup_migrated_${options.appId}_${uid}`;
    const revisionKey = (uid) => `cloud_backup_revision_${options.appId}_${uid}`;
    const releaseKey = (uid) => `cloud_backup_release_${options.appId}_${options.release?.version || 'legacy'}_${uid}`;
    const envelopeFormat = 'wokgui-complete-backup-v2';
    const storedPayload = () => ({
      format: envelopeFormat,
      appId: options.appId,
      release: { ...(options.release || {}) },
      data: options.getPayload()
    });
    const applicationPayload = payload => payload?.format === envelopeFormat && payload.appId === options.appId
      ? payload.data
      : payload;
    const payloadRelease = payload => payload?.format === envelopeFormat && payload.appId === options.appId
      ? payload.release
      : null;
    const downloadJson = (content, filename) => {
      const blob = new Blob([JSON.stringify(content, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    };

    async function current() {
      const { data, error } = await client.from('user_app_backup_current').select('payload,revision,updated_at').eq('user_id', user.id).eq('app_id', options.appId).maybeSingle();
      if (error) throw error;
      return data;
    }

    async function upload(source) {
      if (!user || busy || applying) return false;
      busy = true;
      try {
        status('Sauvegarde en cours…');
        const payload = storedPayload();
        const storedSource = source === 'phone-migration' ? 'phone-migration' : source === 'first-device' ? 'seed' : source.startsWith('restore') ? 'restore' : 'app';
        const { data, error } = await client.from('user_app_backup_current').upsert({ user_id: user.id, app_id: options.appId, payload, source: storedSource }, { onConflict: 'user_id,app_id' }).select('revision,updated_at').maybeSingle();
        if (error) throw error;
        const saved = data || await current();
        if (saved) localStorage.setItem(revisionKey(user.id), String(saved.revision));
        status(saved ? `Sauvegardé automatiquement — version ${saved.revision}` : 'Déjà à jour');
        await loadHistory();
        return true;
      } catch (error) {
        status(`Sauvegarde impossible : ${error.message}`);
        return false;
      } finally {
        busy = false;
      }
    }

    function scheduleUpload() {
      if (!user || applying) return;
      clearTimeout(timer);
      timer = setTimeout(() => upload('automatic'), 1400);
    }

    async function apply(payload, message) {
      applying = true;
      try { await options.applyPayload(applicationPayload(payload)); status(message); }
      finally { applying = false; }
    }

    async function initialSync() {
      const remote = await current();
      const migrated = localStorage.getItem(migratedKey(user.id)) === '1';
      if (!migrated) {
        if (options.localExisted) {
          await upload('phone-migration');
        } else if (remote) {
          await apply(remote.payload, `Version ${remote.revision} restaurée sur cet appareil`);
          localStorage.setItem(revisionKey(user.id), String(remote.revision));
        } else {
          await upload('first-device');
        }
        localStorage.setItem(migratedKey(user.id), '1');
      } else if (remote) {
        const localRevision = Number(localStorage.getItem(revisionKey(user.id)) || 0);
        if (remote.revision > localRevision) {
          await apply(remote.payload, `Version ${remote.revision} récupérée automatiquement`);
          localStorage.setItem(revisionKey(user.id), String(remote.revision));
        } else {
          status(`Sauvegarde active — version ${remote.revision}`);
        }
      } else {
        await upload('recovery');
      }
      if (options.release?.version && localStorage.getItem(releaseKey(user.id)) !== '1') {
        if (await upload('release')) localStorage.setItem(releaseKey(user.id), '1');
      }
      await loadHistory();
    }

    async function loadHistory() {
      if (!user) return;
      const { data, error } = await client.from('user_app_backup_history').select('revision,created_at,source,payload').eq('user_id', user.id).eq('app_id', options.appId).order('revision', { ascending: false }).limit(20);
      if (error) return;
      const list = $('.cloud-backup-history');
      list.innerHTML = '';
      for (const item of data || []) {
        const li = document.createElement('li');
        const date = new Date(item.created_at).toLocaleString('fr-FR');
        const release = payloadRelease(item.payload);
        const zip = release?.sourceZipUrl
          ? `<a class="secondary" href="${release.sourceZipUrl}" target="_blank" rel="noopener">ZIP du site</a>`
          : '<small>ZIP non associé (ancienne sauvegarde)</small>';
        li.innerHTML = `<span>Version ${item.revision}<br><small>${date}</small></span><span class="cloud-backup-history-actions"><button type="button" data-revision="${item.revision}">Restaurer</button>${zip}</span>`;
        list.appendChild(li);
      }
      if (!list.children.length) list.innerHTML = '<li>Aucune ancienne version pour le moment.</li>';
    }

    async function restoreRevision(revision) {
      if (!confirm(`Restaurer la version ${revision} ? La version actuelle restera dans l’historique.`)) return;
      const { data, error } = await client.from('user_app_backup_history').select('payload').eq('user_id', user.id).eq('app_id', options.appId).eq('revision', revision).single();
      if (error) return status(`Restauration impossible : ${error.message}`);
      await apply(data.payload, `Version ${revision} restaurée`);
      await upload(`restore-${revision}`);
    }

    async function setSession(session) {
      user = session?.user || null;
      $('.cloud-backup-auth').classList.toggle('cloud-backup-hidden', !!user);
      $('.cloud-backup-tools').classList.toggle('cloud-backup-hidden', !user);
      if (!user) return status('Connexion nécessaire pour activer la sauvegarde automatique.');
      status(`Connecté : ${user.email}`);
      try { await initialSync(); } catch (error) { status(`Synchronisation impossible : ${error.message}`); }
    }

    button.addEventListener('click', () => { panel.classList.remove('cloud-backup-hidden'); if (user) loadHistory(); });
    $('.cloud-backup-close').addEventListener('click', () => panel.classList.add('cloud-backup-hidden'));
    panel.addEventListener('click', (event) => { if (event.target === panel) panel.classList.add('cloud-backup-hidden'); });
    function credentials() {
      const email = $('.cloud-backup-email').value.trim();
      const password = $('.cloud-backup-password').value;
      if (!email || password.length < 6) { status('Entrez votre e-mail et un mot de passe d’au moins 6 caractères.'); return null; }
      return { email, password };
    }
    $('.cloud-backup-login').addEventListener('click', async () => {
      const values = credentials(); if (!values) return;
      status('Connexion…');
      const { error } = await client.auth.signInWithPassword(values);
      status(error ? `Connexion impossible : ${error.message}` : 'Connexion réussie.');
    });
    $('.cloud-backup-signup').addEventListener('click', async () => {
      const values = credentials(); if (!values) return;
      status('Création de votre accès…');
      const { data, error } = await client.auth.signUp(values);
      if (error) return status(`Création impossible : ${error.message}`);
      status(data.session ? 'Accès créé et sauvegarde activée.' : 'Accès créé. Confirmez l’e-mail reçu, revenez ici, puis appuyez sur « Se connecter ».');
    });
    $('.cloud-backup-now').addEventListener('click', () => upload('manual'));
    $('.cloud-backup-download').addEventListener('click', async () => {
      if (!user) return;
      const saved = await current();
      downloadJson({ app: options.appId, exportedAt: new Date().toISOString(), current: saved }, `${options.appId}-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`);
    });
    $('.cloud-backup-download-all').addEventListener('click', async () => {
      if (!user) return;
      status('Préparation des 20 versions…');
      const [currentResult, historyResult] = await Promise.all([
        client.from('user_app_backup_current').select('payload,revision,updated_at,source').eq('user_id', user.id).eq('app_id', options.appId).maybeSingle(),
        client.from('user_app_backup_history').select('payload,revision,created_at,source').eq('user_id', user.id).eq('app_id', options.appId).order('revision', { ascending: false }).limit(20)
      ]);
      const error = currentResult.error || historyResult.error;
      if (error) return status(`Téléchargement impossible : ${error.message}`);
      downloadJson({ app: options.appId, exportedAt: new Date().toISOString(), current: currentResult.data, history: historyResult.data || [] }, `${options.appId}-20-versions-${new Date().toISOString().slice(0, 10)}.json`);
      status('Les versions ont été téléchargées sur cet appareil.');
    });
    $('.cloud-backup-logout').addEventListener('click', () => client.auth.signOut());
    $('.cloud-backup-history').addEventListener('click', (event) => { const revision = event.target.dataset.revision; if (revision) restoreRevision(Number(revision)); });
    window.addEventListener(options.eventName, scheduleUpload);
    client.auth.onAuthStateChange((_event, session) => setTimeout(() => setSession(session), 0));
    client.auth.getSession().then(({ data }) => setSession(data.session));
  }

  window.AutoBackupCloud = { create };
})();
