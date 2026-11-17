// lol-profile: contrato del módulo de perfil LoL.
//
// Carga el módulo en un contexto aislado (vm) para probar la lógica sin DOM y
// sin red. Verifica funciones puras, el proveedor demo (determinista), la
// normalización del payload y el armado de la URL del proxy. Además controla
// las dos reglas del proyecto que esta feature puede romper: ningún
// `!important` en la hoja nueva y el HTML enlazando sus propios assets.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };
const eq = (a, b, m) => ok(a === b, m + ' (esperado ' + JSON.stringify(b) + ', recibido ' + JSON.stringify(a) + ')');

function loadModule(extra) {
  const src = fs.readFileSync(path.join(ROOT, 'js/lol-profile.js'), 'utf8');
  const sandbox = Object.assign({ window: {}, console }, extra || {});
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'lol-profile.js' });
  return sandbox.window.LoLProfile;
}

const LOL = loadModule();

console.log('\n[1] funciones puras');
eq(LOL.winrate(0, 0), 0, 'sin partidas el winrate es 0, no NaN');
eq(LOL.winrate(58, 42), 0.58, 'winrate 58/42');
eq(LOL.pct(0.5836), '58%', 'pct redondea');
eq(LOL.pct(1.4), '100%', 'pct clampea arriba');
eq(LOL.pct(-1), '0%', 'pct clampea abajo');
eq(LOL.kda(10, 0, 5), 15, 'kda con 0 muertes no divide por cero');
eq(LOL.kda(2, 4, 6), 2, 'kda normal');
eq(LOL.duration(1830), '30:30', 'duración mm:ss');
eq(LOL.duration(65), '1:05', 'duración con segundos a dos dígitos');

console.log('\n[2] racha y forma');
eq(LOL.streak(['W', 'W', 'L']).count, 2, 'cuenta la racha vigente');
eq(LOL.streak(['W', 'W', 'L']).type, 'W', 'tipo de racha');
eq(LOL.streak([]).type, null, 'sin partidas no hay racha');
eq(LOL.form(['W', 'L', 'W'], 2).length, 2, 'form corta al tamaño pedido');
eq(LOL.form(['W', 'L']).length, 2, 'form no inventa partidas');

console.log('\n[3] agregados');
const matches = [
  { champion: 'Ahri', role: 'MID', result: 'W', kills: 9, deaths: 2, assists: 11, cs: 210, duration: 1800 },
  { champion: 'Ahri', role: 'MID', result: 'L', kills: 3, deaths: 6, assists: 5, cs: 190, duration: 1700 },
  { champion: 'Jinx', role: 'ADC', result: 'W', kills: 12, deaths: 4, assists: 8, cs: 260, duration: 2000 }
];
const roles = LOL.roleStats(matches);
eq(roles.length, 2, 'dos roles distintos');
eq(roles[0].role, 'MID', 'ordena por partidas');
eq(roles[0].games, 2, 'cuenta partidas por rol');
eq(roles[0].winrate, 0.5, 'winrate por rol');
const champs = LOL.championStats(matches);
eq(champs[0].champion, 'Ahri', 'campeón más jugado primero');
eq(champs[0].games, 2, 'cuenta partidas por campeón');
eq(champs[0].winrate, 0.5, 'winrate por campeón');
ok(champs[0].kda > 0, 'kda promedio calculado');

console.log('\n[4] identidad del invocador');
ok(LOL.isValidSummoner('Katarina#LAS'), 'Nombre#TAG válido');
ok(!LOL.isValidSummoner('Katarina'), 'sin tag es inválido');
ok(!LOL.isValidSummoner('#LAS'), 'sin nombre es inválido');
ok(!LOL.isValidSummoner('Nombre Con Espacios Y Demasiado Largo#LAS'), 'nombre demasiado largo es inválido');
eq(LOL.splitSummoner('Ahri#1234').tag, '1234', 'separa el tag');
eq(LOL.splitSummoner('Nombre#Con#Tag').name, 'Nombre#Con', 'usa el último # como separador');

console.log('\n[5] proveedor demo');
const FIXED_NOW = 1700000000000;
const a = LOL.demoProfile('Katarina#LAS', 'LAS', { now: FIXED_NOW });
const b = LOL.demoProfile('Katarina#LAS', 'LAS', { now: FIXED_NOW });
eq(JSON.stringify(a), JSON.stringify(b), 'el demo es determinista para el mismo nombre');
eq(a.matches.length, 20, 'genera 20 partidas');
ok(a.matches.every(m => m.result === 'W' || m.result === 'L'), 'todas las partidas tienen resultado');
ok(a.summoner.name === 'Katarina' && a.summoner.tag === 'LAS', 'conserva nombre y tag');
ok(LOL.demoProfile('Otra#LAS', 'LAS').summoner.name === 'Otra', 'no mezcla identidades');

console.log('\n[6] normalización y URLs');
const normalized = LOL.normalizeProfile({ summoner: { name: 'X', tag: 'Y' }, rank: { tier: 'gold', wins: 5, losses: 5 }, matches: [{ champion: 'Lux', win: true, kills: 1, deaths: 2, assists: 3 }] }, {});
eq(normalized.rank.tier, 'GOLD', 'normaliza el tier a mayúsculas');
eq(normalized.matches[0].result, 'W', 'traduce win:true a W');
eq(normalized.matches[0].role, 'MID', 'rol por defecto cuando falta');
eq(LOL.normalizeMatch(null), null, 'descarta partidas sin campeón');
ok(LOL.championIcon('LeeSin', '14.24.1').indexOf('/img/champion/LeeSin.png') > 0, 'URL de ícono de campeón');
ok(LOL.championSplash('Ahri').indexOf('/splash/Ahri_0.jpg') > 0, 'URL de splash');
eq(LOL.escapeHtml('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;', 'escapa HTML');
eq(LOL.timeAgo(new Date(0).toISOString(), 3600 * 1000 * 3), 'hace 3 h', 'tiempo relativo en horas');

console.log('\n[7] proxy: arma la URL y normaliza la respuesta');
const calls = [];
const fakeFetch = (url) => {
  calls.push(url);
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ summoner: { name: 'Ahri', tag: 'LAS' }, matches: [] }) });
};
const LOL2 = loadModule({ fetch: fakeFetch });
const proxied = await LOL2.proxyProfile('https://proxy.example/api/', 'Ahri#LAS', 'LAS');
eq(calls.length, 1, 'una sola llamada al proxy');
eq(calls[0], 'https://proxy.example/api/profile?gameName=Ahri&tagLine=LAS&region=LAS', 'URL del proxy sin doble barra');
eq(proxied.summoner.name, 'Ahri', 'normaliza la respuesta del proxy');

console.log('\n[8] reglas del proyecto');
const cssRaw = fs.readFileSync(path.join(ROOT, 'css/lol.css'), 'utf8');
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, ''); // el comentario de cabecera puede nombrar la regla
ok(!/!important/.test(css), 'css/lol.css no usa !important');
ok(/\.lol-/.test(css), 'los estilos están prefijados con .lol-');
const html = fs.readFileSync(path.join(ROOT, 'lol.html'), 'utf8');
ok(html.indexOf('js/lol-profile.js') > 0, 'lol.html carga el módulo');
ok(html.indexOf('css/lol.css') > 0, 'lol.html carga su hoja');
ok(html.indexOf('assets/favicon.png') > 0, 'lol.html reutiliza el favicon del proyecto');
ok(!/js\/router\.js/.test(html), 'lol.html no arrastra el router de la app');

console.log('\n' + pass + ' pass / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
