// lol-core: contrato del motor de draft, progreso y coach.
// Carga el módulo en un contexto aislado (vm) para probar la lógica sin DOM
// ni red, y fija los umbrales que sostienen las tres herramientas.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL: ' + m)); };
const eq = (a, b, m) => ok(a === b, m + ' (esperado ' + JSON.stringify(b) + ', recibido ' + JSON.stringify(a) + ')');

const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/lol-core.js'), 'utf8'), sandbox, { filename: 'lol-core.js' });
const core = sandbox.window.LoLCore;

function champ(id, tags, info, range) {
  return { id, name: id, tags: tags || [], info: info || {}, stats: { attackrange: range || 125 } };
}

console.log('\n[1] clasificación de campeones');
const jinx = core.classify(champ('Jinx', ['Marksman'], { attack: 9, defense: 2, magic: 1 }, 525));
eq(jinx.range, 'ranged', 'Jinx es ranged por attackrange');
eq(jinx.damage, 'AD', 'Jinx es AD');
eq(jinx.scaling, 'late', 'Jinx escala a late');
eq(jinx.role, 'ADC', 'Jinx es ADC');

const leona = core.classify(champ('Leona', ['Tank', 'Support'], { attack: 4, defense: 8, magic: 4 }));
eq(leona.frontline, true, 'Leona es primera línea');
eq(leona.engage, true, 'Leona tiene engage');
eq(leona.role, 'SUPPORT', 'Leona es support');

const kassadin = core.classify(champ('Kassadin', ['Mage', 'Assassin'], { attack: 3, defense: 4, magic: 9 }));
eq(kassadin.damage, 'AP', 'Kassadin es AP');
eq(kassadin.scaling, 'late', 'Kassadin escala');

const lee = core.classify(champ('LeeSin', ['Fighter', 'Assassin'], { attack: 8, defense: 5, magic: 1 }));
eq(lee.role, 'JUNGLE', 'Lee Sin se detecta jungla');
eq(lee.scaling, 'early', 'Lee Sin es de early');

console.log('\n[2] analista de draft');
const sinFront = core.analyzeDraft({
  allies: [champ('Jinx', ['Marksman'], { attack: 9, defense: 2, magic: 1 }, 525), champ('Lux', ['Mage'], { attack: 3, defense: 3, magic: 9 }, 550)],
  enemies: [champ('Zed', ['Assassin'], { attack: 9, defense: 4, magic: 1 })]
});
ok(sinFront.findings.some(f => f.title.indexOf('Sin primera línea') >= 0), 'detecta composición sin frontline');
eq(sinFront.counts.frontline, 0, 'cuenta cero frontlines');

const todoAd = core.analyzeDraft({
  allies: [champ('Jinx', ['Marksman'], { attack: 9, defense: 2, magic: 1 }, 525), champ('Zed', ['Assassin'], { attack: 9, defense: 4, magic: 1 })],
  enemies: []
});
ok(todoAd.findings.some(f => f.title.indexOf('Todo el daño es físico') >= 0), 'detecta composición full AD');

const okDraft = core.analyzeDraft(core.demoDraft());
ok(okDraft.counts.frontline >= 2, 'el draft demo tiene primera línea');
ok(okDraft.winCondition.length > 10, 'devuelve condición de victoria');
ok(okDraft.plan.length > 0, 'devuelve un plan');

console.log('\n[3] coach post-partida');
const analysis = core.analyzeMatch(core.demoMatch());
ok(analysis.score < 100, 'una partida con problemas no saca 100');
ok(analysis.score >= 0, 'el puntaje no baja de cero');
ok(analysis.findings.some(f => f.title.indexOf('muertes antes del minuto 10') >= 0 || f.title.indexOf('muertes tempranas') >= 0), 'detecta muertes tempranas');
ok(analysis.findings.some(f => f.title.indexOf('Farmeo') >= 0), 'detecta farmeo bajo');
ok(analysis.findings.some(f => f.title.indexOf('Moriste antes de objetivos') >= 0), 'detecta muertes antes de objetivos');
eq(analysis.match.champion, 'Jinx', 'normaliza el campeón');
eq(analysis.metrics.csPerMin.toFixed(1), (178 / (1912 / 60)).toFixed(1), 'calcula CS por minuto');

const clean = core.analyzeMatch({
  champion: 'Jinx', role: 'ADC', result: 'W', kills: 12, deaths: 1, assists: 10,
  cs: 260, duration: 1800, vision: 20, teamKills: 30, events: []
});
eq(clean.score, 100, 'una partida limpia saca 100');

console.log('\n[4] progreso personal');
const progress = core.summarizeProgress(core.demoMatches());
eq(progress.games, 12, 'cuenta las partidas');
ok(progress.winrate > 0 && progress.winrate < 1, 'calcula winrate');
ok(progress.byChampion.length === 3, 'agrupa por campeón');
ok(progress.byPatch.length >= 1, 'agrupa por parche');
ok(typeof progress.tilt === 'string' && progress.tilt.length > 0, 'detecta tres derrotas seguidas');
ok(progress.trend !== null, 'calcula tendencia');
eq(progress.streak, 3, 'cuenta la racha vigente');

console.log('\n[5] normalización');
const riot = core.normalizeMatch({
  info: { gameDuration: 1800, gameVersion: '14.24.1', participants: [{ championName: 'Ahri', teamPosition: 'MIDDLE', win: true, kills: 5, deaths: 2, assists: 7, totalMinionsKilled: 180, neutralMinionsKilled: 20, visionScore: 15 }] },
  me: { championName: 'Ahri', teamPosition: 'MIDDLE', win: true, kills: 5, deaths: 2, assists: 7, totalMinionsKilled: 180, neutralMinionsKilled: 20, visionScore: 15 }
});
eq(riot.result, 'W', 'traduce win a W');
eq(riot.cs, 200, 'suma minions de línea y jungla');

console.log('\n[6] reglas del proyecto');
const css = fs.readFileSync(path.join(ROOT, 'css/lol.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/!important/.test(css), 'css sin !important');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ok(html.indexOf('lol-core.js') > 0, 'index.html carga el motor');
ok(html.indexOf('lol-ui.js') > 0, 'index.html carga la interfaz');
ok(html.indexOf('data-tab="draft"') > 0, 'hay pestaña de draft');

console.log('\n' + pass + ' pass / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
