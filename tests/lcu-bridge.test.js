// lcu-bridge: contrato del puente con el cliente de League of Legends.
// Prueba las funciones puras (lockfile, normalización de partidas, rango y
// draft) sin cliente abierto y sin red.
import {
  parseLockfile, normalizeGame, roleFromLane, normalizeRank, normalizeDraft
} from '../tools/lcu-bridge.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };
const eq = (a, b, m) => ok(a === b, m + ' (esperado ' + JSON.stringify(b) + ', recibido ' + JSON.stringify(a) + ')');

console.log('\n[1] lockfile');
const lock = parseLockfile('LeagueClient:1234:54321:secreto:https');
eq(lock.port, 54321, 'lee el puerto');
eq(lock.password, 'secreto', 'lee la contraseña');
eq(lock.protocol, 'https', 'lee el protocolo');
eq(parseLockfile('cualquier cosa'), null, 'rechaza un lockfile inválido');
eq(parseLockfile(''), null, 'rechaza vacío');

console.log('\n[2] carril y rol');
eq(roleFromLane('JUNGLE', ''), 'JUNGLE', 'jungla');
eq(roleFromLane('BOTTOM', 'DUO_SUPPORT'), 'SUPPORT', 'support');
eq(roleFromLane('BOTTOM', 'DUO_CARRY'), 'ADC', 'tirador');
eq(roleFromLane('MIDDLE', 'SOLO'), 'MID', 'mid');
eq(roleFromLane('', ''), 'MID', 'por defecto mid');

console.log('\n[3] rango');
const ranked = normalizeRank({ queueMap: { RANKED_SOLO_5x5: { tier: 'gold', division: 'II', leaguePoints: 44, wins: 10, losses: 6 } } });
eq(ranked.tier, 'GOLD', 'normaliza el tier');
eq(ranked.lp, 44, 'lee los puntos');
eq(normalizeRank(null).tier, 'UNRANKED', 'sin datos es unranked');

console.log('\n[4] partida del cliente');
const byKey = new Map([[222, 'Jinx'], [1, 'Annie']]);
const game = {
  gameCreation: 1700000000000,
  gameDuration: 1800,
  gameVersion: '14.24.1',
  participantIdentities: [
    { participantId: 1, player: { puuid: 'yo' } },
    { participantId: 2, player: { puuid: 'otro' } }
  ],
  participants: [
    { participantId: 1, championId: 222, teamId: 100, stats: { win: true, kills: 9, deaths: 2, assists: 7, totalMinionsKilled: 180, neutralMinionsKilled: 20, visionScore: 15, goldEarned: 12000 }, timeline: { lane: 'BOTTOM', role: 'DUO_CARRY' } },
    { participantId: 2, championId: 1, teamId: 100, stats: { win: true, kills: 3 } }
  ]
};
const match = normalizeGame(game, 'yo', byKey);
eq(match.champion, 'Jinx', 'mapea el id numérico al nombre');
eq(match.role, 'ADC', 'detecta el rol');
eq(match.result, 'W', 'traduce la victoria');
eq(match.cs, 200, 'suma línea y jungla');
eq(match.teamKills, 12, 'suma las muertes del equipo');
eq(match.patch, '14.24.1', 'conserva el parche');
ok(match.playedAt.startsWith('2023'), 'convierte la fecha');

const sinMapa = normalizeGame(game, 'yo', new Map());
eq(sinMapa.champion, '222', 'sin mapa conserva el id numérico');

console.log('\n[5] champ select');
const draft = normalizeDraft({
  myTeam: [{ championId: 222, assignedPosition: 'bottom' }, { championId: 0 }],
  theirTeam: [{ championId: 1, assignedPosition: 'middle' }]
}, byKey);
eq(draft.allies.length, 1, 'descarta los slots vacíos');
eq(draft.allies[0].id, 'Jinx', 'mapea el campeón aliado');
eq(draft.enemies[0].id, 'Annie', 'mapea el campeón rival');
eq(normalizeDraft(null, byKey).allies.length, 0, 'sin sesión devuelve vacío');

console.log('\n' + pass + ' pass / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
