/**
 * riot-proxy.mjs — proxy mínimo para la Riot API.
 *
 * Por qué existe: la Riot API no permite CORS desde el navegador, así que una
 * página estática no puede consultarla. Este Worker mantiene la clave del lado
 * del servidor y devuelve un JSON ya normalizado al formato que consume
 * `js/lol-profile.js` (normalizeProfile).
 *
 * Rutas:
 *   GET /health
 *   GET /profile?gameName=Ahri&tagLine=LAS&region=LAS
 *
 * Variables de entorno:
 *   RIOT_API_KEY  (secreto, nunca en el repo)
 */

const ROUTE = {
  las: 'americas', lan: 'americas', na: 'americas', br: 'americas',
  euw: 'europe', eune: 'europe', tr: 'europe', ru: 'europe',
  kr: 'asia', jp: 'asia', oce: 'sea'
};

const PLATFORM = {
  las: 'la1', lan: 'la2', na: 'na1', br: 'br1',
  euw: 'euw1', eune: 'eune1', tr: 'tr1', ru: 'ru',
  kr: 'kr', jp: 'jp1', oce: 'oc1'
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' }, CORS)
  });
}

async function riot(path, key) {
  const response = await fetch(path, { headers: { 'X-Riot-Token': key } });
  if (response.status === 404) return null;
  if (response.status === 401) throw new Error('Riot no reconoce la clave (Unknown apikey). Copiá de nuevo la Development API Key del panel: cambia cada vez que la regenerás.');
  if (response.status === 403) throw new Error('La clave de Riot no es válida o expiró');
  if (response.status === 429) throw new Error('Límite de peticiones de Riot alcanzado, probá en un minuto');
  if (!response.ok) throw new Error('Riot respondió ' + response.status);
  return response.json();
}

function roleFromPosition(teamPosition) {
  const map = { TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MID', BOTTOM: 'ADC', UTILITY: 'SUPPORT' };
  return map[String(teamPosition || '').toUpperCase()] || 'MID';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/health') return json({ ok: true });

    if (url.pathname !== '/profile') return json({ error: 'Ruta no encontrada' }, 404);

    const gameName = (url.searchParams.get('gameName') || '').trim();
    const tagLine = (url.searchParams.get('tagLine') || '').trim();
    const region = (url.searchParams.get('region') || 'LAS').trim().toUpperCase();

    if (!gameName || !tagLine) return json({ error: 'Faltan gameName y tagLine' }, 400);

    const route = ROUTE[region.toLowerCase()] || 'americas';
    const platform = PLATFORM[region.toLowerCase()] || 'la1';
    const key = env.RIOT_API_KEY;
    if (!key) return json({ error: 'Falta RIOT_API_KEY en el Worker' }, 500);

    try {
      const account = await riot(
        'https://' + route + '.api.riotgames.com/riot/account/v1/accounts/by-riot-id/' +
          encodeURIComponent(gameName) + '/' + encodeURIComponent(tagLine), key);
      if (!account || !account.puuid) return json({ error: 'Invocador no encontrado' }, 404);

      const summoner = await riot(
        'https://' + platform + '.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/' +
          encodeURIComponent(account.puuid), key);

      let rank = { tier: 'UNRANKED', division: '', lp: 0, wins: 0, losses: 0 };
      const entries = await riot(
        'https://' + platform + '.api.riotgames.com/lol/league/v4/entries/by-puuid/' +
          encodeURIComponent(account.puuid), key);
      if (Array.isArray(entries)) {
        const solo = entries.find((e) => e.queueType === 'RANKED_SOLO_5x5') || entries[0];
        if (solo) {
          rank = {
            tier: String(solo.tier || 'UNRANKED').toUpperCase(),
            division: solo.rank || '',
            lp: Number(solo.leaguePoints || 0),
            wins: Number(solo.wins || 0),
            losses: Number(solo.losses || 0)
          };
        }
      }

      const ids = await riot(
        'https://' + route + '.api.riotgames.com/lol/match/v5/matches/by-puuid/' +
          encodeURIComponent(account.puuid) + '/ids?start=0&count=20', key);

      const matches = [];
      for (const id of (ids || []).slice(0, 20)) {
        const match = await riot('https://' + route + '.api.riotgames.com/lol/match/v5/matches/' + id, key);
        if (!match || !match.info) continue;
        const me = (match.info.participants || []).find((p) => p.puuid === account.puuid);
        if (!me) continue;
        matches.push({
          champion: me.championName,
          role: roleFromPosition(me.teamPosition),
          result: me.win ? 'W' : 'L',
          kills: me.kills,
          deaths: me.deaths,
          assists: me.assists,
          cs: Number(me.totalMinionsKilled || 0) + Number(me.neutralMinionsKilled || 0),
          duration: match.info.gameDuration,
          playedAt: new Date(match.info.gameEndTimestamp || match.info.gameStartTimestamp || Date.now()).toISOString()
        });
      }

      return json({
        summoner: {
          name: account.gameName || gameName,
          tag: account.tagLine || tagLine,
          level: Number((summoner && summoner.summonerLevel) || 0),
          region,
          iconId: Number((summoner && summoner.profileIconId) || 29)
        },
        rank,
        matches,
        demo: false
      });
    } catch (error) {
      return json({ error: String((error && error.message) || error) }, 500);
    }
  }
};
