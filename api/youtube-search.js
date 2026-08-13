const YOUTUBE_SEARCH = 'https://www.youtube.com/results?search_query=';
const NOTUBE_BASE = 'https://notube.lol/fr/youtube-app-394';

function firstVideoId(html) {
  const renderer = html.match(/"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/);
  if (renderer) return renderer[1];
  const fallback = html.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
  return fallback ? fallback[1] : '';
}

module.exports = async function handler(request, response) {
  const query = String(request.query?.q || '').trim().slice(0, 180);
  const target = request.query?.target === 'download' ? 'download' : 'youtube';
  const redirect = request.query?.redirect === '1';

  if (!query) {
    return response.status(400).json({ error: 'Recherche manquante.' });
  }

  try {
    const youtubeResponse = await fetch(YOUTUBE_SEARCH + encodeURIComponent(query), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        Cookie: 'SOCS=CAI',
      },
    });
    if (!youtubeResponse.ok) throw new Error('YouTube indisponible');

    const videoId = firstVideoId(await youtubeResponse.text());
    if (!videoId) throw new Error('Vidéo introuvable');

    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const destination = target === 'download'
      ? `${NOTUBE_BASE}?v=${encodeURIComponent(videoId)}`
      : youtubeUrl;

    response.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    if (redirect) return response.redirect(302, destination);
    return response.status(200).json({ videoId, youtubeUrl, destination });
  } catch (error) {
    const fallback = target === 'download'
      ? NOTUBE_BASE
      : YOUTUBE_SEARCH + encodeURIComponent(query);
    if (redirect) return response.redirect(302, fallback);
    return response.status(502).json({ error: error.message, destination: fallback });
  }
};
