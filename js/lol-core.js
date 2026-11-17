/*!
 * lol-core.js v1.0.0 — motor de las tres herramientas
 *
 * A) Analista de draft: clasifica campeones y evalúa la composición.
 * B) Progreso personal: métricas, tendencias y señal de tilt.
 * C) Coach post-partida: hallazgos causales con severidad.
 *
 * Todo el cálculo es puro y vive acá; la UI está en lol-ui.js. Los datos de
 * campeones salen de Data Dragon (sin clave, CORS abierto) y se clasifican con
 * heurísticas + una capa curada de arquetipos.
 *
 * API: window.LoLCore = { fetchChampions, classify, analyzeDraft,
 *                         analyzeMatch, summarizeProgress, demoDraft, demoMatch,
 *                         demoMatches }
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.LoLCore = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DDRAGON = 'https://ddragon.leagueoflegends.com';
  var FALLBACK_VERSION = '14.24.1';

  // ── Capa curada de arquetipos ────────────────────────────────
  // Lo que los tags de Riot no dicen: quién inicia, quién aguanta la línea
  // de frente, quién escala y quién gana la partida temprano.

  var ENGAGE = toSet('Alistar Amumu Blitzcrank Braum Camille Diana Galio Gragas Hecarim JarvanIV Kled Leona Lillia Malphite Maokai Nautilus Ornn Poppy Rakan Rammus Rell Sejuani Sett Shen Skarner Sion Thresh Vi Warwick Wukong XinZhao Zac');
  var FRONTLINE = toSet('Aatrox Alistar Amumu Braum ChoGath Darius DrMundo Garen Gnar Gragas Illaoi JarvanIV KSante Leona Malphite Maokai Mordekaiser Nasus Nautilus Ornn Poppy Rammus Rell Renekton Sejuani Sett Shen Singed Sion Skarner TahmKench Taric Thresh Trundle Udyr Urgot Vi Volibear Warwick Wukong Yorick Zac');
  var LATE = toSet('Aphelios AurelionSol Azir Gwen Jinx Kaisa Kassadin Kayle KogMaw MasterYi Nasus Ryze Senna Seraphine Smolder Sona Twitch Vayne Veigar Vladimir Xerath Zeri');
  var EARLY = toSet('Caitlyn Draven Elise KhaZix LeeSin Lucian MissFortune Nidalee Olaf Pantheon Pyke RekSai Renekton Rengar Talon Trundle Warwick XinZhao Zed');
  var JUNGLERS = toSet('Amumu Belveth Briar Diana Ekko Elise Evelynn Fiddlesticks Graves Hecarim Ivern JarvanIV Karthus Kayn KhaZix Kindred LeeSin Lillia MasterYi Nidalee Nocturne Nunu Olaf Pantheon Poppy Rammus RekSai Rengar Sejuani Shaco Shyvana Skarner Taliyah Talon Trundle Udyr Vi Viego Volibear Warwick Wukong XinZhao Zac Zed');
  var AP_TANKS = toSet('Amumu Gragas Maokai Malphite Mordekaiser Nunu Rumble Sejuani Singed Vladimir Zac');
  var AP_CHAMPS = toSet('Akali Diana Ekko Fizz Gwen Katarina Kassadin Sylas Teemo');
  var HYBRID = toSet('Corki Ezreal Kaisa Kayle KogMaw Varus');
  var IMMOBILE_CARRY = toSet('Jinx KogMaw MissFortune Ashe Varus Sona Soraka Xerath Veigar Brand Zyra Ziggs Lux');

  function toSet(text) {
    var out = {};
    String(text || '').split(/\s+/).forEach(function (name) {
      if (name) out[name.toLowerCase()] = true;
    });
    return out;
  }
  function has(set, id) { return !!set[String(id || '').toLowerCase()]; }

  // ── Clasificación ────────────────────────────────────────────

  function deriveRange(champ) {
    var range = Number((champ.stats && champ.stats.attackrange) || 0);
    if (!range) return 'melee';
    return range >= 300 ? 'ranged' : 'melee';
  }

  function deriveDamage(champ) {
    var id = champ.id;
    if (has(AP_CHAMPS, id)) return 'AP';
    if (has(HYBRID, id)) return 'hybrid';
    var tags = champ.tags || [];
    var info = champ.info || {};
    var attack = Number(info.attack || 0);
    var magic = Number(info.magic || 0);

    if (has(AP_TANKS, id)) return 'AP';
    if (tags.indexOf('Support') >= 0) return attack > magic + 3 ? 'AD' : 'AP';
    if (tags.indexOf('Mage') >= 0) return attack > magic ? 'AD' : 'AP';
    if (tags.indexOf('Assassin') >= 0) return magic > attack ? 'AP' : 'AD';
    if (tags.indexOf('Marksman') >= 0) return 'AD';
    return attack >= magic ? 'AD' : 'AP';
  }

  function deriveRole(champ) {
    var id = champ.id;
    if (has(JUNGLERS, id)) return 'JUNGLE';
    var tags = champ.tags || [];
    if (tags.indexOf('Support') >= 0) return 'SUPPORT';
    if (tags.indexOf('Marksman') >= 0) return 'ADC';
    if (tags.indexOf('Mage') >= 0 || tags.indexOf('Assassin') >= 0) return 'MID';
    return 'TOP';
  }

  function classify(champ) {
    champ = champ || {};
    var id = champ.id;
    var tags = champ.tags || [];
    var info = champ.info || {};
    var defense = Number(info.defense || 0);
    var range = deriveRange(champ);
    var tank = tags.indexOf('Tank') >= 0 || defense >= 7;
    var frontline = has(FRONTLINE, id) || (tank && range === 'melee');
    var scaling = has(LATE, id) ? 'late' : (has(EARLY, id) ? 'early' : 'mid');
    return {
      id: id,
      name: champ.name || id,
      tags: tags,
      range: range,
      damage: deriveDamage(champ),
      role: deriveRole(champ),
      tank: tank,
      frontline: frontline,
      engage: has(ENGAGE, id),
      cc: has(ENGAGE, id) || tags.indexOf('Tank') >= 0,
      scaling: scaling
    };
  }

  // ── A. Analista de draft ─────────────────────────────────────

  function countBy(list, key) {
    var out = {};
    list.forEach(function (item) {
      var value = item[key];
      out[value] = (out[value] || 0) + 1;
    });
    return out;
  }

  function analyzeDraft(draft) {
    draft = draft || {};
    var allies = (draft.allies || []).filter(Boolean).map(classify);
    var enemies = (draft.enemies || []).filter(Boolean).map(classify);
    var you = allies[0] || null;
    var findings = [];

    function add(level, title, detail) { findings.push({ level: level, title: title, detail: detail }); }

    var front = allies.filter(function (c) { return c.frontline; }).length;
    var engage = allies.filter(function (c) { return c.engage; }).length;
    var damage = countBy(allies, 'damage');
    var ranged = allies.filter(function (c) { return c.range === 'ranged'; }).length;
    var late = allies.filter(function (c) { return c.scaling === 'late'; }).length;
    var early = allies.filter(function (c) { return c.scaling === 'early'; }).length;

    if (front === 0) {
      add('CRITICO', 'Sin primera línea', 'Nadie aguanta el frente: cualquier pelea 5v5 empieza perdiendo. Jugá por picks y no aceptes peleas de frente.');
    } else if (front === 1 && ranged >= 3) {
      add('ALTO', 'Una sola primera línea', 'Con tres o más ranged, ese tanque va a estar solo. Necesitás peel o jugar por oleadas.');
    }
    if (engage === 0) {
      add('ALTO', 'Sin inicio de pelea', 'No tenés forma de abrir un 5v5. Dependés de que el rival se equivoque o de un pick aislado.');
    }
    if ((damage.AD || 0) === 0) {
      add('ALTO', 'Todo el daño es mágico', 'El rival compra una sola resistencia y apaga a todo el equipo.');
    }
    if ((damage.AP || 0) === 0) {
      add('ALTO', 'Todo el daño es físico', 'El rival compra armadura y el equipo no tiene cómo responder.');
    }
    if (late >= 3 && early === 0) {
      add('MEDIO', 'Composición de escalado', 'Tres campeones que necesitan ítems. Sobrevivir los primeros 20 minutos ES la partida.');
    }
    if (early >= 3) {
      add('MEDIO', 'Composición temprana', 'La ventaja se gana antes de los 20. Si llegás a late sin ventaja, la curva se invierte.');
    }

    var enemyAssassins = enemies.filter(function (c) { return (c.tags || []).indexOf('Assassin') >= 0; }).length;
    var enemyFront = enemies.filter(function (c) { return c.frontline; }).length;

    if (you && enemyAssassins >= 2 && has(IMMOBILE_CARRY, you.id)) {
      add('ALTO', 'Dos asesinos contra un carry inmóvil', 'Tu campeón no tiene escape. Posicionate detrás de la primera línea o comprá un ítem defensivo temprano.');
    }
    if (you && you.range === 'ranged' && enemyFront >= 2) {
      add('MEDIO', 'Dos frontlines enemigas', 'Van a querer entrar sobre vos. Guardá tu habilidad de escape para después de su inicio.');
    }
    if (enemies.length === 5 && (damage.AD || 0) > 0 && (damage.AP || 0) === 0) {
      add('BAJO', 'Sugerencia de ítems', 'Contra una composición sin daño mágico, la armadura rinde más que la resistencia mágica.', '');
    }

    return {
      you: you,
      allies: allies,
      enemies: enemies,
      counts: {
        frontline: front, engage: engage, ranged: ranged,
        ad: damage.AD || 0, ap: damage.AP || 0, hybrid: damage.hybrid || 0,
        late: late, early: early
      },
      winCondition: winCondition(you, { front: front, engage: engage, late: late, early: early, damage: damage }),
      plan: planFor(you, { front: front, engage: engage, late: late, early: early }),
      findings: sortFindings(findings)
    };
  }

  function sortFindings(list) {
    var order = { CRITICO: 0, ALTO: 1, MEDIO: 2, BAJO: 3 };
    return list.slice().sort(function (a, b) { return order[a.level] - order[b.level]; });
  }

  function winCondition(you, s) {
    if (!you) return 'Elegí tu campeón para ver la condición de victoria.';
    if (s.early > s.late && s.early >= 2) return 'Ganar antes de los 25: pelear por objetivos temprano y cerrar la partida.';
    if (s.late >= 2) return 'Llegar a ítems: farmear seguro, evitar peleas sin ventaja y escalar.';
    if (s.engage >= 2 && s.front >= 2) return 'Forzar 5v5: iniciar con tu primera línea y pelear por objetivos.';
    return 'Jugar por picks y control de visión antes que por peleas abiertas.';
  }

  function planFor(you, s) {
    if (!you) return [];
    var plan = [];
    if (you.scaling === 'early') plan.push('Temprano: buscá ventaja en línea y convertí en placas u objetivos.');
    if (you.scaling === 'late') plan.push('Temprano: priorizá farmeo y no regales muertes; tu pico llega con dos ítems.');
    if (you.engage) plan.push('Buscá el inicio cuando tenga visión del rival y tu equipo esté cerca.');
    if (you.frontline) plan.push('Cubrí a tus carries: tu trabajo es absorber, no perseguir.');
    if (you.range === 'ranged' && !you.frontline) plan.push('Mantenete detrás de la primera línea y atacá al objetivo más cercano.');
    if (s.front === 0) plan.push('Sin tanque: peleá en pasillos y con visión, nunca en campo abierto.');
    return plan;
  }

  // ── C. Coach post-partida ────────────────────────────────────

  function normalizeMatch(raw) {
    raw = raw || {};
    var info = raw.info || raw;
    var me = raw.me || (info.participants || []).find(function (p) { return p.puuid === raw.puuid; }) || {};
    var duration = Number(info.gameDuration || raw.duration || 0);
    var kills = Number(me.kills != null ? me.kills : raw.kills || 0);
    var deaths = Number(me.deaths != null ? me.deaths : raw.deaths || 0);
    var assists = Number(me.assists != null ? me.assists : raw.assists || 0);
    var cs = Number(me.totalMinionsKilled != null
      ? Number(me.totalMinionsKilled || 0) + Number(me.neutralMinionsKilled || 0)
      : raw.cs || 0);
    return {
      champion: String(me.championName || raw.champion || '?'),
      role: String(me.teamPosition || raw.role || 'MID').toUpperCase(),
      result: (me.win === true || raw.result === 'W') ? 'W' : 'L',
      kills: kills,
      deaths: deaths,
      assists: assists,
      cs: cs,
      duration: duration,
      vision: Number(me.visionScore != null ? me.visionScore : raw.vision || 0),
      gold: Number(me.goldEarned != null ? me.goldEarned : raw.gold || 0),
      damageShare: Number(raw.damageShare || 0),
      goldDiff15: Number(raw.goldDiff15 || 0),
      patch: String(info.gameVersion || raw.patch || ''),
      playedAt: raw.playedAt || new Date(info.gameEndTimestamp || Date.now()).toISOString(),
      events: Array.isArray(raw.events) ? raw.events : [],
      teamKills: Number(raw.teamKills || 0)
    };
  }

  function analyzeMatch(raw) {
    var match = normalizeMatch(raw);
    var minutes = Math.max(1, match.duration / 60);
    var csPerMin = match.cs / minutes;
    var visionPerMin = match.vision / minutes;
    var kda = (match.kills + match.assists) / Math.max(1, match.deaths);
    var findings = [];
    var score = 100;

    function add(level, penalty, title, detail) {
      findings.push({ level: level, title: title, detail: detail });
      score -= penalty;
    }

    var earlyDeaths = match.events.filter(function (e) {
      return e.type === 'death' && Number(e.minute) <= 10;
    }).length;
    if (earlyDeaths >= 3) {
      add('ALTO', 18, 'Tres o más muertes antes del minuto 10',
        'Cada muerte temprana cuesta oleada y prioridad. Jugá más atrás hasta tu primer ítem.');
    } else if (earlyDeaths === 2) {
      add('MEDIO', 8, 'Dos muertes tempranas', 'Revisá si fueron por gank o por trade forzado.');
    }

    if (match.role !== 'SUPPORT') {
      var csTarget = match.role === 'JUNGLE' ? 4.5 : 6;
      if (csPerMin < csTarget * 0.75) {
        add('ALTO', 15, 'Farmeo bajo: ' + csPerMin.toFixed(1) + ' CS/min',
          'Para tu rol el piso es ' + csTarget + '. Perdés oro y niveles sin darte cuenta.');
      } else if (csPerMin < csTarget) {
        add('MEDIO', 7, 'Farmeo por debajo del objetivo: ' + csPerMin.toFixed(1) + ' CS/min',
          'Objetivo para ' + match.role + ': ' + csTarget + ' CS/min.');
      }
    }

    if (match.role === 'SUPPORT') {
      // El support no farmea: su economía se mide en visión y en participación.
      if (visionPerMin < 1.2) {
        add('ALTO', 12, 'Visión baja para support: ' + visionPerMin.toFixed(2) + '/min',
          'El objetivo del rol es 1.2 por minuto. Un centinela en cada recall y un control en cada objetivo.');
      }
    } else if (visionPerMin < 0.5) {
      add('MEDIO', 7, 'Visión escasa: ' + visionPerMin.toFixed(2) + ' por minuto',
        'Sin visión no hay picks ni defensa de objetivos. Un centinela por recall alcanza.');
    }

    if (match.teamKills > 0) {
      var kp = (match.kills + match.assists) / match.teamKills;
      if (kp < 0.35) {
        add('MEDIO', 8, 'Participación baja: ' + Math.round(kp * 100) + '%',
          'Estuviste lejos de las peleas. Revisá si estabas farmeando lejos del objetivo.');
      }
    }

    var deathsBeforeObjective = match.events.filter(function (e) {
      return e.type === 'death' && e.beforeObjective === true;
    }).length;
    if (deathsBeforeObjective >= 2) {
      add('ALTO', 14, 'Moriste antes de objetivos',
        'Una muerte 40 segundos antes de un dragón o barón regala el objetivo. Peleá después de asegurar la visión.');
    }

    if (match.goldDiff15 <= -1500) {
      add('ALTO', 12, 'Desventaja de oro al minuto 15',
        'Perdiste ' + Math.abs(match.goldDiff15) + ' de oro en la fase de líneas. Priorizá no repetir el patrón del primer choque.');
    }

    if (match.damageShare > 0 && match.damageShare < 0.15 && match.role !== 'SUPPORT') {
      add('MEDIO', 6, 'Daño bajo para tu rol: ' + Math.round(match.damageShare * 100) + '%',
        'O no llegaste a las peleas o pegaste sobre el objetivo equivocado.');
    }

    if (match.duration < 20 * 60) {
      add('BAJO', 4, 'Partida corta', 'Las partidas de menos de 20 minutos suelen decidirse por tres peleas. Revisalas en el replay.');
    }

    var critical = findings.filter(function (f) { return f.level === 'CRITICO'; }).length;
    if (critical) score -= 15 * critical;

    return {
      match: match,
      metrics: { csPerMin: csPerMin, visionPerMin: visionPerMin, kda: kda, kp: match.teamKills ? (match.kills + match.assists) / match.teamKills : 0 },
      findings: sortFindings(findings),
      score: Math.max(0, Math.min(100, Math.round(score)))
    };
  }

  // ── B. Progreso personal ────────────────────────────────────

  function average(list, fn) {
    if (!list.length) return 0;
    return list.reduce(function (acc, item) { return acc + fn(item); }, 0) / list.length;
  }

  function summarizeProgress(rawMatches) {
    var matches = (rawMatches || []).map(normalizeMatch).filter(function (m) { return m.champion !== '?'; });
    if (!matches.length) {
      return { games: 0, winrate: 0, kda: 0, csPerMin: 0, visionPerMin: 0, deaths: 0, streak: 0, tilt: null, byChampion: [], byPatch: [], trend: null };
    }
    var wins = matches.filter(function (m) { return m.result === 'W'; }).length;
    var totalMinutes = matches.reduce(function (a, m) { return a + m.duration / 60; }, 0) || 1;
    var streak = 0;
    for (var i = 0; i < matches.length; i++) {
      if (matches[i].result === matches[0].result) streak++;
      else break;
    }

    var byChampion = {};
    matches.forEach(function (m) {
      if (!byChampion[m.champion]) byChampion[m.champion] = { champion: m.champion, games: 0, wins: 0, cs: 0, deaths: 0 };
      var c = byChampion[m.champion];
      c.games++;
      if (m.result === 'W') c.wins++;
      c.cs += m.cs;
      c.deaths += m.deaths;
    });

    var byPatch = {};
    matches.forEach(function (m) {
      var patch = (m.patch || '').split('.').slice(0, 2).join('.') || 'sin parche';
      if (!byPatch[patch]) byPatch[patch] = { patch: patch, games: 0, wins: 0 };
      byPatch[patch].games++;
      if (m.result === 'W') byPatch[patch].wins++;
    });

    var half = Math.floor(matches.length / 2) || 1;
    var recent = matches.slice(0, half);
    var older = matches.slice(half);
    var trend = {
      csPerMin: average(recent, function (m) { return m.cs / Math.max(1, m.duration / 60); }) -
        average(older, function (m) { return m.cs / Math.max(1, m.duration / 60); }),
      deaths: average(recent, function (m) { return m.deaths; }) - average(older, function (m) { return m.deaths; }),
      winrate: (recent.filter(function (m) { return m.result === 'W'; }).length / recent.length) -
        (older.length ? older.filter(function (m) { return m.result === 'W'; }).length / older.length : 0)
    };

    var tilt = null;
    var lastThree = matches.slice(0, 3);
    if (lastThree.length === 3 && lastThree.every(function (m) { return m.result === 'L'; })) {
      tilt = 'Tres derrotas seguidas. Tomate una pausa: el rendimiento cae más después de la tercera.';
    } else if (trend.deaths > 1.5) {
      tilt = 'Tus muertes subieron en las últimas partidas. Estás jugando más expuesto que antes.';
    }

    // El CS no mide a un support: el promedio se calcula solo con las partidas
    // donde farmear es parte del rol.
    var farmGames = matches.filter(function (m) { return m.role !== 'SUPPORT'; });
    var farmMinutes = farmGames.reduce(function (a, m) { return a + m.duration / 60; }, 0) || 1;

    return {
      games: matches.length,
      winrate: wins / matches.length,
      kda: (matches.reduce(function (a, m) { return a + m.kills + m.assists; }, 0)) / Math.max(1, matches.reduce(function (a, m) { return a + m.deaths; }, 0)),
      csPerMin: farmGames.length ? farmGames.reduce(function (a, m) { return a + m.cs; }, 0) / farmMinutes : 0,
      csGames: farmGames.length,
      visionPerMin: matches.reduce(function (a, m) { return a + m.vision; }, 0) / totalMinutes,
      deaths: average(matches, function (m) { return m.deaths; }),
      streak: streak,
      tilt: tilt,
      trend: trend,
      byChampion: Object.keys(byChampion).map(function (k) {
        var c = byChampion[k];
        return { champion: c.champion, games: c.games, winrate: c.wins / c.games, deaths: c.deaths / c.games, cs: c.cs / c.games };
      }).sort(function (a, b) { return b.games - a.games; }),
      byPatch: Object.keys(byPatch).map(function (k) {
        var p = byPatch[k];
        return { patch: p.patch, games: p.games, winrate: p.wins / p.games };
      })
    };
  }

  // ── Datos de demostración ───────────────────────────────────

  function demoDraft() {
    return {
      allies: [
        { id: 'Jinx', name: 'Jinx', tags: ['Marksman'], info: { attack: 9, defense: 2, magic: 1, difficulty: 4 }, stats: { attackrange: 525 } },
        { id: 'Thresh', name: 'Thresh', tags: ['Support', 'Tank'], info: { attack: 3, defense: 7, magic: 5, difficulty: 6 }, stats: { attackrange: 450 } },
        { id: 'Orianna', name: 'Orianna', tags: ['Mage'], info: { attack: 4, defense: 3, magic: 9, difficulty: 7 }, stats: { attackrange: 525 } },
        { id: 'JarvanIV', name: 'Jarvan IV', tags: ['Fighter', 'Tank'], info: { attack: 7, defense: 6, magic: 3, difficulty: 5 }, stats: { attackrange: 175 } },
        { id: 'Sett', name: 'Sett', tags: ['Fighter', 'Tank'], info: { attack: 8, defense: 6, magic: 1, difficulty: 4 }, stats: { attackrange: 125 } }
      ],
      enemies: [
        { id: 'Zed', name: 'Zed', tags: ['Assassin'], info: { attack: 9, defense: 4, magic: 1, difficulty: 7 }, stats: { attackrange: 125 } },
        { id: 'Akali', name: 'Akali', tags: ['Assassin', 'Mage'], info: { attack: 5, defense: 4, magic: 8, difficulty: 8 }, stats: { attackrange: 125 } },
        { id: 'Malphite', name: 'Malphite', tags: ['Tank'], info: { attack: 5, defense: 9, magic: 4, difficulty: 3 }, stats: { attackrange: 125 } },
        { id: 'Leona', name: 'Leona', tags: ['Tank', 'Support'], info: { attack: 4, defense: 8, magic: 4, difficulty: 4 }, stats: { attackrange: 125 } },
        { id: 'Caitlyn', name: 'Caitlyn', tags: ['Marksman'], info: { attack: 8, defense: 2, magic: 1, difficulty: 6 }, stats: { attackrange: 650 } }
      ]
    };
  }

  function demoMatch(result) {
    return {
      champion: 'Jinx',
      role: 'ADC',
      result: result || 'L',
      kills: 7,
      deaths: 6,
      assists: 5,
      cs: 178,
      duration: 1912,
      vision: 12,
      gold: 11200,
      damageShare: 0.21,
      goldDiff15: -2100,
      patch: '14.24.1',
      teamKills: 21,
      playedAt: new Date().toISOString(),
      events: [
        { type: 'death', minute: 6 },
        { type: 'death', minute: 9 },
        { type: 'death', minute: 14, beforeObjective: true },
        { type: 'death', minute: 23 },
        { type: 'death', minute: 28, beforeObjective: true },
        { type: 'death', minute: 31 }
      ]
    };
  }

  function demoMatches() {
    var out = [];
    var now = Date.now();
    var results = ['L', 'L', 'L', 'W', 'L', 'W', 'W', 'L', 'W', 'W', 'L', 'W'];
    results.forEach(function (result, index) {
      out.push({
        champion: index % 3 === 0 ? 'Jinx' : (index % 3 === 1 ? 'Caitlyn' : 'Ashe'),
        role: 'ADC',
        result: result,
        kills: 4 + (index % 6),
        deaths: 3 + (index % 4),
        assists: 3 + (index % 7),
        cs: 150 + (index % 5) * 20,
        duration: 1600 + (index % 4) * 180,
        vision: 9 + (index % 6),
        patch: '14.24.1',
        teamKills: 20 + (index % 5),
        playedAt: new Date(now - index * 3600000).toISOString()
      });
    });
    return out;
  }

  // ── Data Dragon ────────────────────────────────────────────

  function fetchChampions(version) {
    var v = version || FALLBACK_VERSION;
    if (typeof fetch !== 'function') return Promise.reject(new Error('fetch no disponible'));
    return fetch(DDRAGON + '/cdn/' + v + '/data/es_ES/champion.json', { cache: 'force-cache' })
      .then(function (response) {
        if (!response.ok) throw new Error('Data Dragon respondió ' + response.status);
        return response.json();
      })
      .then(function (payload) {
        var data = (payload && payload.data) || {};
        return Object.keys(data).map(function (key) { return data[key]; })
          .sort(function (a, b) { return a.name.localeCompare(b.name, 'es'); });
      });
  }

  function fetchVersion() {
    if (typeof fetch !== 'function') return Promise.resolve(FALLBACK_VERSION);
    return fetch(DDRAGON + '/api/versions.json', { cache: 'force-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (list) { return (Array.isArray(list) && list[0]) || FALLBACK_VERSION; })
      .catch(function () { return FALLBACK_VERSION; });
  }

  return {
    fetchChampions: fetchChampions,
    fetchVersion: fetchVersion,
    classify: classify,
    analyzeDraft: analyzeDraft,
    analyzeMatch: analyzeMatch,
    normalizeMatch: normalizeMatch,
    summarizeProgress: summarizeProgress,
    demoDraft: demoDraft,
    demoMatch: demoMatch,
    demoMatches: demoMatches
  };
});
