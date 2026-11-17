#!/usr/bin/env node
/**
 * lcu-bridge.mjs — puente entre la página y el cliente de League of Legends.
 *
 * El navegador no puede leer el archivo `lockfile` ni aceptar el certificado
 * autofirmado del cliente, así que este proceso local hace de intermediario:
 * lee el lockfile, habla con la LCU y expone HTTP con CORS en 127.0.0.1.
 *
 *   node tools/lcu-bridge.mjs            # lee el cliente real
 *   node tools/lcu-bridge.mjs --demo     # sirve datos de ejemplo (sin cliente)
 *   node tools/lcu-bridge.mjs --port 8787
 *
 * Endpoints:
 *   GET /health    → { ok, client }
 *   GET /profile   → { summoner, rank, matches }  (mismo formato que el proxy de Riot)
 *   GET /matches   → [ match ]                    (para Progreso y Análisis)
 *   GET /draft     → { allies, enemies }          (champ select en vivo)
 *
 * Sin dependencias externas.
 */

import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';

const LOCKFILE_CANDIDATES = [
  'C:/Riot Games/League of Legends/lockfile',
  '/Applications/League of Legends.app/Contents/LoL/lockfile',
  '/opt/league-of-legends/lockfile'
];

const DDRAGON = 'https://ddragon.leagueoflegends.com';

export function parseLockfile(text) {
  const parts = String(text || '').trim().split(':');
  if (parts.length < 5) return null;
  const port = Number(parts[2]);
  if (!port) return null;
  return { name: parts[0], pid: Number(parts[1]), port, password: parts[3], protocol: parts[4] || 'https' };
}

export function readLockfile(candidates = LOCKFILE_CANDIDATES) {
  for (const file of candidates) {
    try {
      const parsed = parseLockfile(fs.readFileSync(file, 'utf8'));
      if (parsed) return parsed;
    } catch { /* siguiente */ }
  }
  return null;
}

export function lcuRequest(lock, pathname) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      host: '127.0.0.1',
      port: lock.port,
      path: pathname,
      method: 'GET',
      rejectUnauthorized: false,
      headers: {
        Authorization: 'Basic ' + Buffer.from('riot:' + lock.password).toString('base64'),
        Accept: 'application/json'
      }
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode >= 400) return reject(new Error('LCU ' + response.statusCode + ' en ' + pathname));
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.setTimeout(4000, () => request.destroy(new Error('timeout de la LCU')));
    request.end();
  });
}

export async function championMap() {
  const versions = await fetch(DDRAGON + '/api/versions.json').then((r) => r.json());
  const version = versions[0];
  const payload = await fetch(DDRAGON + '/cdn/' + version + '/data/es_ES/champion.json').then((r) => r.json());
  const byKey = new Map();
  for (const id of Object.keys(payload.data || {})) {
    const champ = payload.data[id];
    byKey.set(Number(champ.key), champ.id);
  }
  return byKey;
}

export function normalizeGame(game, puuid, byKey) {
  const identities = game.participantIdentities || [];
  const mine = identities.find((identity) => identity.player && identity.player.puuid === puuid);
  const participantId = mine ? mine.participantId : null;
  const me = (game.participants || []).find((p) => (participantId && p.participantId === participantId)) ||
    (game.participants || [])[0] || {};
  const stats = me.stats || {};
  const timeline = me.timeline || {};
  const teamKills = (game.participants || [])
    .filter((p) => p.teamId === me.teamId)
    .reduce((acc, p) => acc + Number((p.stats && p.stats.kills) || 0), 0);

  return {
    champion: byKey.get(Number(me.championId)) || String(me.championId || '?'),
    role: roleFromLane(timeline.lane, timeline.role),
    result: stats.win ? 'W' : 'L',
    kills: Number(stats.kills || 0),
    deaths: Number(stats.deaths || 0),
    assists: Number(stats.assists || 0),
    cs: Number(stats.totalMinionsKilled || 0) + Number(stats.neutralMinionsKilled || 0),
    duration: Number(game.gameDuration || 0),
    vision: Number(stats.visionScore || 0),
    gold: Number(stats.goldEarned || 0),
    teamKills,
    patch: String(game.gameVersion || ''),
    playedAt: new Date(Number(game.gameCreation || Date.now())).toISOString()
  };
}

export function roleFromLane(lane, role) {
  const l = String(lane || '').toUpperCase();
  const r = String(role || '').toUpperCase();
  if (l === 'JUNGLE') return 'JUNGLE';
  if (l === 'TOP') return 'TOP';
  if (l === 'MIDDLE' || l === 'MID') return 'MID';
  if (l === 'BOTTOM' || l === 'BOT') return r === 'DUO_SUPPORT' ? 'SUPPORT' : 'ADC';
  if (r === 'SUPPORT') return 'SUPPORT';
  if (r === 'DUO' || r === 'DUO_CARRY' || r === 'CARRY') return 'ADC';
  if (r === 'SOLO') return 'TOP';
  return 'MID';
}

export function normalizeRank(payload) {
  const queue = (payload && payload.queueMap && (payload.queueMap.RANKED_SOLO_5x5 || payload.queueMap.RANKED_FLEX_SR)) || null;
  if (!queue) return { tier: 'UNRANKED', division: '', lp: 0, wins: 0, losses: 0 };
  return {
    tier: String(queue.tier || 'UNRANKED').toUpperCase(),
    division: queue.division || '',
    lp: Number(queue.leaguePoints || 0),
    wins: Number(queue.wins || 0),
    losses: Number(queue.losses || 0)
  };
}

export function normalizeDraft(session, byKey) {
  const map = (list) => (list || []).map((member) => ({
    id: byKey.get(Number(member.championId)) || null,
    position: String(member.assignedPosition || '').toUpperCase() || null
  })).filter((member) => member.id);
  return { allies: map(session && session.myTeam), enemies: map(session && session.theirTeam) };
}

// ── Servidor ─────────────────────────────────────────────────

const DEMO = {
  summoner: { name: 'Invocador Demo', tag: 'LAS', level: 312, region: 'LAS', iconId: 29 },
  rank: { tier: 'PLATINUM', division: 'II', lp: 64, wins: 58, losses: 42 },
  matches: [
    { champion: 'Jinx', role: 'ADC', result: 'W', kills: 11, deaths: 3, assists: 9, cs: 231, duration: 1850, vision: 18, patch: '14.24.1', teamKills: 28, playedAt: new Date().toISOString() },
    { champion: 'Caitlyn', role: 'ADC', result: 'L', kills: 4, deaths: 6, assists: 5, cs: 190, duration: 1720, vision: 12, patch: '14.24.1', teamKills: 19, playedAt: new Date(Date.now() - 3600000).toISOString() }
  ]
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // Chrome/Edge piden este header cuando una página HTTPS llama a localhost
    // (Private Network Access). Sin él, la página publicada no puede hablar
    // con el puente.
    'Access-Control-Allow-Private-Network': 'true'
  };
}

function json(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors()));
  response.end(text);
}

async function buildProfile(lock, byKey) {
  const summoner = await lcuRequest(lock, '/lol-summoner/v1/current-summoner');
  const rankPayload = await lcuRequest(lock, '/lol-ranked/v1/current-ranked-stats').catch(() => null);
  const puuid = summoner.puuid;

  let games = [];
  try {
    const history = await lcuRequest(lock, '/lol-match-history/v1/products/lol/' + encodeURIComponent(puuid) + '/matches?begIndex=0&endIndex=20');
    games = (history && history.games && history.games.games) || [];
  } catch {
    const fallback = await lcuRequest(lock, '/lol-match-history/v1/games?begIndex=0&endIndex=20').catch(() => null);
    games = (fallback && fallback.games) || [];
  }

  // El resumen trae solo mi participante: no permite calcular las muertes del
  // equipo ni el carril. Para las últimas 10 partidas se pide el detalle, que
  // sí trae los 10 participantes. El resto queda como resumen.
  const detailed = await Promise.all(games.slice(0, 10).map((game) =>
    lcuRequest(lock, '/lol-match-history/v1/games/' + game.gameId).catch(() => null)
  ));
  const full = games.map((game, index) => (index < detailed.length && detailed[index]) || game);

  const matches = full
    .map((game) => normalizeGame(game, puuid, byKey))
    .filter((match) => match.duration > 0)
    .filter((match) => match.kills + match.deaths + match.assists + match.cs > 0);

  return {
    summoner: {
      name: summoner.gameName || summoner.displayName || 'Invocador',
      tag: summoner.tagLine || 'LAS',
      level: Number(summoner.summonerLevel || 0),
      region: 'LAS',
      iconId: Number(summoner.profileIconId || 29)
    },
    rank: normalizeRank(rankPayload),
    matches,
    demo: false
  };
}

export async function startServer(options = {}) {
  const port = Number(options.port || process.env.LCU_BRIDGE_PORT || 8787);
  const demo = options.demo === true;
  let byKey = new Map();

  try { byKey = await championMap(); } catch { byKey = new Map(); }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'OPTIONS') { response.writeHead(204, cors()); return response.end(); }

    if (url.pathname === '/health') {
      const lock = demo ? null : readLockfile();
      return json(response, 200, { ok: true, client: demo ? 'demo' : (lock ? 'conectado' : 'no encontrado') });
    }

    if (demo) {
      if (url.pathname === '/profile') return json(response, 200, DEMO);
      if (url.pathname === '/matches') return json(response, 200, DEMO.matches);
      if (url.pathname === '/draft') return json(response, 200, { allies: [{ id: 'Jinx' }], enemies: [{ id: 'Zed' }] });
      return json(response, 404, { error: 'Ruta no encontrada' });
    }

    const lock = readLockfile();
    if (!lock) return json(response, 503, { error: 'No encontré el cliente abierto. Abrí League of Legends.' });

    try {
      if (url.pathname === '/profile') return json(response, 200, await buildProfile(lock, byKey));
      if (url.pathname === '/matches') return json(response, 200, (await buildProfile(lock, byKey)).matches);
      if (url.pathname === '/draft') {
        const session = await lcuRequest(lock, '/lol-champ-select/v1/session').catch(() => null);
        if (!session) return json(response, 204, { allies: [], enemies: [] });
        return json(response, 200, normalizeDraft(session, byKey));
      }
      return json(response, 404, { error: 'Ruta no encontrada' });
    } catch (error) {
      return json(response, 502, { error: String(error && error.message || error) });
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return server;
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('lcu-bridge.mjs');
if (isDirectRun) {
  const demo = process.argv.includes('--demo');
  const portArg = process.argv.indexOf('--port');
  const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 8787;
  startServer({ port, demo }).then(() => {
    console.log('[lcu-bridge] escuchando en http://127.0.0.1:' + port + (demo ? ' (modo demo)' : ''));
    console.log('[lcu-bridge] pegá esa URL en la pestaña Perfil para conectar la página.');
  }).catch((error) => {
    console.error('[lcu-bridge] no pudo arrancar:', error.message);
    process.exit(1);
  });
}
