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

    if (url.pathname === '/extras') {
      const region = (url.searchParams.get('region') || 'LAS').toUpperCase();
      const platform = PLATFORM[region.toLowerCase()] || 'la1';
      const route = ROUTE[region.toLowerCase()] || 'americas';
      const key = env.RIOT_API_KEY;
      if (!key) return json({ error: 'Falta RIOT_API_KEY en el Worker' }, 500);

      const status = await riot('https://' + platform + '.api.riotgames.com/lol/status/v4/platform-data', key).catch(() => null);
      const rotation = await riot('https://' + platform + '.api.riotgames.com/lol/platform/v3/champion-rotations', key).catch(() => null);

      const gameName = (url.searchParams.get('gameName') || '').trim();
      const tagLine = (url.searchParams.get('tagLine') || '').trim();
      let challenges = null;
      let live = null;

      if (gameName && tagLine) {
        const account = await riot('https://' + route + '.api.riotgames.com/riot/account/v1/accounts/by-riot-id/' +
          encodeURIComponent(gameName) + '/' + encodeURIComponent(tagLine), key).catch(() => null);
        if (account && account.puuid) {
          const player = await riot('https://' + platform + '.api.riotgames.com/lol/challenges/v1/player-data/' +
            account.puuid, key).catch(() => null);
          if (player) {
            challenges = {
              total: Number(player.totalPoints || 0),
              category: Number((player.categoryPoints && player.categoryPoints.COLLECTION) || 0),
              top: (player.challenges || []).filter((c) => c.level === 'MASTER' || c.level === 'GRANDMASTER' || c.level === 'CHALLENGER')
                .slice(0, 5).map((c) => ({ id: c.challengeId, level: c.level, value: c.value }))
            };
          }
          const game = await riot('https://' + platform + '.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/' +
            account.puuid, key).catch(() => null);
          live = game ? { active: true, mode: String(game.gameMode || ''), length: Number(game.gameLength || 0) } : { active: false };
        }
      }

      return json({
        region,
        status: status ? {
          name: status.name,
          incidents: (status.incidents || []).length,
          maintenances: (status.maintenances || []).length
        } : null,
        rotation: rotation ? {
          free: (rotation.freeChampionIds || []).length,
          newPlayer: (rotation.freeChampionIdsForNewPlayers || []).length
        } : null,
        challenges,
        live
      });
    }

    if (url.pathname === '/raw') {
      const region = (url.searchParams.get('region') || 'LAS').toUpperCase();
      const platform = PLATFORM[region.toLowerCase()] || 'la1';
      const route = ROUTE[region.toLowerCase()] || 'americas';
      const key = env.RIOT_API_KEY;
      if (!key) return json({ error: 'Falta RIOT_API_KEY en el Worker' }, 500);
      const what = url.searchParams.get('endpoint') || 'account';
      const gameName = (url.searchParams.get('gameName') || '').trim();
      const tagLine = (url.searchParams.get('tagLine') || '').trim();
      try {
        if (what === 'timeline') {
          const matchId = url.searchParams.get('matchId');
          if (!matchId) return json({ error: 'Falta matchId' }, 400);
          return json({ endpoint: what, data: await riot('https://' + route + '.api.riotgames.com/lol/match/v5/matches/' + encodeURIComponent(matchId) + '/timeline', key) });
        }
        let puuid = url.searchParams.get('puuid') || '';
        if (!puuid && gameName && tagLine) {
          const acc = await riot('https://' + route + '.api.riotgames.com/riot/account/v1/accounts/by-riot-id/' +
            encodeURIComponent(gameName) + '/' + encodeURIComponent(tagLine), key).catch(() => null);
          puuid = (acc && acc.puuid) || '';
        }
        const targets = {
          account: 'https://' + route + '.api.riotgames.com/riot/account/v1/accounts/by-puuid/' + puuid,
          summoner: 'https://' + platform + '.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/' + puuid,
          league: 'https://' + platform + '.api.riotgames.com/lol/league/v4/entries/by-puuid/' + puuid,
          mastery: 'https://' + platform + '.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/' + puuid + '/top?count=10',
          matches: 'https://' + route + '.api.riotgames.com/lol/match/v5/matches/by-puuid/' + puuid + '/ids?count=10',
          challenges: 'https://' + platform + '.api.riotgames.com/lol/challenges/v1/player-data/' + puuid,
          clash: 'https://' + platform + '.api.riotgames.com/lol/clash/v1/players/by-puuid/' + puuid,
          rotation: 'https://' + platform + '.api.riotgames.com/lol/platform/v3/champion-rotations',
          status: 'https://' + platform + '.api.riotgames.com/lol/status/v4/platform-data'
        };
        const target = targets[what];
        if (!target) return json({ error: 'Endpoint no soportado' }, 400);
        if (!puuid && what !== 'rotation' && what !== 'status') return json({ error: 'Falta el invocador' }, 400);
        return json({ endpoint: what, data: await riot(target, key) });
      } catch (error) {
        return json({ error: String((error && error.message) || error) }, 500);
      }
    }

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
      const list = (ids || []).slice(0, 20);
      for (let index = 0; index < list.length; index += 1) {
        const id = list[index];
        const match = await riot('https://' + route + '.api.riotgames.com/lol/match/v5/matches/' + id, key);
        if (!match || !match.info) continue;
        const me = (match.info.participants || []).find((p) => p.puuid === account.puuid);
        if (!me) continue;
        const teamById = {};
        for (const p of match.info.participants || []) teamById[p.participantId] = p.teamId;
        const entry = {
          champion: me.championName,
          role: roleFromPosition(me.teamPosition),
          result: me.win ? 'W' : 'L',
          kills: me.kills,
          deaths: me.deaths,
          assists: me.assists,
          cs: Number(me.totalMinionsKilled || 0) + Number(me.neutralMinionsKilled || 0),
          duration: match.info.gameDuration,
          vision: Number(me.visionScore || 0),
          patch: String(match.info.gameVersion || ''),
          teamKills: (match.info.participants || []).filter((p) => p.teamId === me.teamId)
            .reduce((acc, p) => acc + Number(p.kills || 0), 0),
          playedAt: new Date(match.info.gameEndTimestamp || match.info.gameStartTimestamp || Date.now()).toISOString(),
          events: [],
          goldDiff15: 0
        };
        if (index < 5) {
          const timeline = await riot('https://' + route + '.api.riotgames.com/lol/match/v5/matches/' + id + '/timeline', key).catch(() => null);
          if (timeline) {
            const facts = timelineFacts(timeline, account.puuid, teamById);
            entry.events = facts.events;
            entry.goldDiff15 = facts.goldDiff15;
          }
        }
        matches.push(entry);
      }

      const mastery = await riot('https://' + platform + '.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/' +
        encodeURIComponent(account.puuid) + '/top?count=5', key).catch(() => null);
      const live = await riot('https://' + platform + '.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/' +
        encodeURIComponent(account.puuid), key).catch(() => null);

      return json({
        summoner: {
          name: account.gameName || gameName,
          tag: account.tagLine || tagLine,
          level: Number((summoner && summoner.summonerLevel) || 0),
          region,
          iconId: Number((summoner && summoner.profileIconId) || 29)
        },
        rank,
        mastery: (Array.isArray(mastery) ? mastery : []).map((m) => ({
          championId: Number(m.championId || 0),
          level: Number(m.championLevel || 0),
          points: Number(m.championPoints || 0)
        })),
        live: live != null,
        matches,
        demo: false
      });
    } catch (error) {
      return json({ error: String((error && error.message) || error) }, 500);
    }
  }
};

/**
 * Muertes propias con minuto y marca de "antes de objetivo enemigo",
 * más la diferencia de oro al minuto 15.
 */
function timelineFacts(timeline, puuid, teamById) {
  const info = (timeline && timeline.info) || {};
  const me = (info.participants || []).find((p) => p.puuid === puuid);
  if (!me) return { events: [], goldDiff15: 0 };
  const myId = me.participantId;
  const myTeam = teamById[myId];
  const deaths = [];
  const enemyObjectives = [];
  let goldDiff15 = 0;

  for (const frame of info.frames || []) {
    for (const event of frame.events || []) {
      if (event.type === 'CHAMPION_KILL' && Number(event.victimId) === myId) {
        deaths.push({ type: 'death', minute: Math.round(Number(event.timestamp || 0) / 60000) });
      }
      if (event.type === 'ELITE_MONSTER_KILL' && Number(event.killerTeamId) !== Number(myTeam) &&
          ['DRAGON', 'BARON_NASHOR', 'RIFTHERALD', 'HORDE'].indexOf(event.monsterType) >= 0) {
        enemyObjectives.push(Number(event.timestamp || 0) / 60000);
      }
    }
    if (Number(frame.timestamp || 0) / 60000 <= 15) {
      let mine = 0;
      let theirs = 0;
      for (const key of Object.keys(frame.participantFrames || {})) {
        const p = frame.participantFrames[key];
        const team = teamById[p.participantId];
        if (team == null) continue;
        if (Number(team) === Number(myTeam)) mine += Number(p.totalGold || 0);
        else theirs += Number(p.totalGold || 0);
      }
      if (mine || theirs) goldDiff15 = mine - theirs;
    }
  }

  for (const death of deaths) {
    death.beforeObjective = enemyObjectives.some((m) => m >= death.minute && m - death.minute <= 1);
  }
  return { events: deaths, goldDiff15 };
}
