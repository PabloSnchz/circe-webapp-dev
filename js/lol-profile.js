/*!
 * lol-profile.js v1.0.0 — Perfil de invocador de League of Legends
 *
 * Página independiente (lol.html). No toca el DOM de la app ni el router:
 * monta todo dentro del contenedor que recibe. Estética Wild Rift: hextech,
 * dorado, azul arcano, tarjetas con borde izquierdo semántico.
 *
 * Datos: proveedor "demo" determinista (mismo nombre → mismos datos) y
 * proveedor "proxy" para conectar la Riot API a través de un endpoint propio,
 * porque la Riot API no permite CORS desde el navegador y esta app no tiene
 * backend. Los íconos y el splash salen de Data Dragon (CDN público).
 *
 * API: window.LoLProfile = { mount, demoProfile, proxyProfile, normalizeProfile,
 *                            winrate, kda, streak, form, duration, roleStats,
 *                            championStats, isValidSummoner, splitSummoner,
 *                            championIcon, championSplash, profileIcon }
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.LoLProfile = api;
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DDRAGON = 'https://ddragon.leagueoflegends.com';
  var FALLBACK_VERSION = '14.24.1';
  var DEFAULT_PROXY = 'https://riot-proxy.circe-lol.workers.dev';
  var STORE_LAST = 'gn:lol:last';
  var STORE_PROXY = 'gn:lol:proxy';
  var REGIONS = ['LAS', 'LAN', 'NA', 'BR', 'EUW', 'EUNE', 'KR', 'JP', 'OCE', 'TR', 'RU'];

  var TIER_COLORS = {
    IRON: '#7a7f87', BRONZE: '#a9714b', SILVER: '#c3ccd8', GOLD: '#e0b64f',
    PLATINUM: '#4fc7b8', EMERALD: '#3ecf8e', DIAMOND: '#5aa9ff',
    MASTER: '#b46cf0', GRANDMASTER: '#ff5468', CHALLENGER: '#ffd166',
    UNRANKED: '#6b7890'
  };

  var CHAMPIONS = [
    { id: 'Ahri', role: 'MID' }, { id: 'Akali', role: 'MID' }, { id: 'Yasuo', role: 'MID' },
    { id: 'Lux', role: 'MID' }, { id: 'Zed', role: 'MID' }, { id: 'Sylas', role: 'MID' },
    { id: 'Jinx', role: 'ADC' }, { id: 'Kaisa', role: 'ADC' }, { id: 'Ezreal', role: 'ADC' },
    { id: 'Samira', role: 'ADC' }, { id: 'Caitlyn', role: 'ADC' },
    { id: 'LeeSin', role: 'JUNGLE' }, { id: 'Vi', role: 'JUNGLE' }, { id: 'Viego', role: 'JUNGLE' },
    { id: 'Kayn', role: 'JUNGLE' }, { id: 'Hecarim', role: 'JUNGLE' },
    { id: 'Darius', role: 'TOP' }, { id: 'Camille', role: 'TOP' }, { id: 'Aatrox', role: 'TOP' },
    { id: 'Fiora', role: 'TOP' }, { id: 'Malphite', role: 'TOP' },
    { id: 'Thresh', role: 'SUPPORT' }, { id: 'Lulu', role: 'SUPPORT' }, { id: 'Nautilus', role: 'SUPPORT' },
    { id: 'Leona', role: 'SUPPORT' }, { id: 'Janna', role: 'SUPPORT' }
  ];

  // ── Utilidades puras ─────────────────────────────────────────

  function clamp(n, min, max) {
    n = Number(n);
    if (!isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function winrate(wins, losses) {
    var total = Number(wins || 0) + Number(losses || 0);
    return total > 0 ? Number(wins || 0) / total : 0;
  }

  function pct(value) {
    var v = Number(value || 0);
    if (!isFinite(v)) v = 0;
    return Math.round(clamp(v, 0, 1) * 100) + '%';
  }

  function kda(kills, deaths, assists) {
    var d = Math.max(1, Number(deaths || 0));
    return (Number(kills || 0) + Number(assists || 0)) / d;
  }

  function duration(seconds) {
    var s = Math.max(0, Math.round(Number(seconds || 0)));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  // results: ['W','L',...] del más reciente al más viejo.
  function streak(results) {
    var list = Array.isArray(results) ? results : [];
    if (!list.length) return { type: null, count: 0 };
    var type = list[0];
    var count = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] !== type) break;
      count++;
    }
    return { type: type, count: count };
  }

  function form(results, size) {
    var n = size == null ? 10 : size;
    return (Array.isArray(results) ? results : []).slice(0, Math.max(0, n));
  }

  function timeAgo(iso, nowMs) {
    var then = Date.parse(iso);
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    if (!isFinite(then)) return '';
    var diff = Math.max(0, now - then);
    var min = Math.floor(diff / 60000);
    if (min < 60) return 'hace ' + Math.max(1, min) + ' min';
    var hours = Math.floor(min / 60);
    if (hours < 24) return 'hace ' + hours + ' h';
    var days = Math.floor(hours / 24);
    if (days < 30) return 'hace ' + days + ' d';
    var months = Math.floor(days / 30);
    return 'hace ' + months + ' mes' + (months === 1 ? '' : 'es');
  }

  function roleStats(matches) {
    var map = {};
    (Array.isArray(matches) ? matches : []).forEach(function (m) {
      if (!m || !m.role) return;
      var key = m.role;
      if (!map[key]) map[key] = { role: key, games: 0, wins: 0 };
      map[key].games++;
      if (m.result === 'W') map[key].wins++;
    });
    return Object.keys(map).map(function (key) {
      var r = map[key];
      return { role: r.role, games: r.games, wins: r.wins, winrate: r.wins / r.games };
    }).sort(function (a, b) { return b.games - a.games; });
  }

  function championStats(matches) {
    var map = {};
    (Array.isArray(matches) ? matches : []).forEach(function (m) {
      if (!m || !m.champion) return;
      var key = m.champion;
      if (!map[key]) map[key] = { champion: key, games: 0, wins: 0, kdaSum: 0, csSum: 0 };
      var c = map[key];
      c.games++;
      if (m.result === 'W') c.wins++;
      c.kdaSum += kda(m.kills, m.deaths, m.assists);
      c.csSum += Number(m.cs || 0);
    });
    return Object.keys(map).map(function (key) {
      var c = map[key];
      return {
        champion: c.champion,
        games: c.games,
        wins: c.wins,
        winrate: c.wins / c.games,
        kda: c.kdaSum / c.games,
        cs: c.csSum / c.games
      };
    }).sort(function (a, b) { return b.games - a.games; });
  }

  function isValidSummoner(value) {
    return /^[^#]{1,16}#[A-Za-z0-9]{2,5}$/.test(String(value || '').trim());
  }

  function splitSummoner(value) {
    var text = String(value || '').trim();
    var at = text.lastIndexOf('#');
    if (at < 1) return { name: text, tag: '' };
    return { name: text.slice(0, at).trim(), tag: text.slice(at + 1).trim() };
  }

  function championIcon(championId, version) {
    return DDRAGON + '/cdn/' + (version || FALLBACK_VERSION) + '/img/champion/' + encodeURIComponent(championId) + '.png';
  }

  function championSplash(championId) {
    return DDRAGON + '/cdn/img/champion/splash/' + encodeURIComponent(championId) + '_0.jpg';
  }

  function profileIcon(iconId, version) {
    return DDRAGON + '/cdn/' + (version || FALLBACK_VERSION) + '/img/profileicon/' + encodeURIComponent(iconId) + '.png';
  }

  function tierColor(tier) {
    return TIER_COLORS[String(tier || '').toUpperCase()] || TIER_COLORS.UNRANKED;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Generador determinista: el mismo nombre produce siempre el mismo perfil.
  function hashString(text) {
    var h = 2166136261 >>> 0;
    var s = String(text || '');
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── Proveedor demo ───────────────────────────────────────────

  var DEMO_TIERS = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
  var DEMO_DIVISIONS = ['IV', 'III', 'II', 'I'];

  function demoProfile(summonerKey, region, options) {
    var identity = splitSummoner(summonerKey);
    var name = identity.name || 'Invocador';
    var tag = identity.tag || 'LAS';
    var rnd = mulberry32(hashString(name + '#' + tag + '@' + (region || 'LAS')));
    var rankIndex = Math.floor(rnd() * DEMO_TIERS.length);
    var wins = 40 + Math.floor(rnd() * 80);
    var losses = 40 + Math.floor(rnd() * 70);
    var total = wins + losses;
    var matches = [];
    // Redondeado al minuto: dos llamadas seguidas con el mismo nombre dan el
    // mismo perfil, y el test puede fijar el instante con options.now.
    var now = Math.floor(Number(options && options.now) || Date.now());
    now = Math.floor(now / 60000) * 60000;
    var winTarget = 0.42 + rnd() * 0.24;

    for (var i = 0; i < 20; i++) {
      var champ = CHAMPIONS[Math.floor(rnd() * CHAMPIONS.length)];
      var isWin = rnd() < winTarget;
      matches.push({
        champion: champ.id,
        role: champ.role,
        result: isWin ? 'W' : 'L',
        kills: Math.floor(rnd() * 12),
        deaths: 2 + Math.floor(rnd() * 8),
        assists: Math.floor(rnd() * 15),
        cs: 90 + Math.floor(rnd() * 220),
        duration: 900 + Math.floor(rnd() * 1200),
        playedAt: new Date(now - (i * (45 + Math.floor(rnd() * 60))) * 60000).toISOString()
      });
    }

    return {
      summoner: {
        name: name,
        tag: tag,
        level: 40 + Math.floor(rnd() * 300),
        region: region || 'LAS',
        iconId: 1 + Math.floor(rnd() * 28)
      },
      rank: {
        tier: DEMO_TIERS[rankIndex],
        division: DEMO_DIVISIONS[Math.floor(rnd() * DEMO_DIVISIONS.length)],
        lp: Math.floor(rnd() * 100),
        wins: wins,
        losses: losses
      },
      matches: matches,
      demo: true,
      totalGames: total
    };
  }

  // ── Normalización y proveedor proxy ──────────────────────────

  function normalizeMatch(raw) {
    if (!raw || !raw.champion) return null;
    var result = String(raw.result || (raw.win === true ? 'W' : 'L')).toUpperCase() === 'W' ? 'W' : 'L';
    return {
      champion: String(raw.champion),
      role: String(raw.role || 'MID').toUpperCase(),
      result: result,
      kills: Number(raw.kills || 0),
      deaths: Number(raw.deaths || 0),
      assists: Number(raw.assists || 0),
      cs: Number(raw.cs || 0),
      duration: Number(raw.duration || 0),
      playedAt: raw.playedAt || new Date().toISOString()
    };
  }

  function normalizeProfile(raw, fallback) {
    raw = raw || {};
    fallback = fallback || {};
    var s = raw.summoner || {};
    var rank = raw.rank || {};
    var matches = (Array.isArray(raw.matches) ? raw.matches : []).map(normalizeMatch).filter(Boolean);
    return {
      summoner: {
        name: String(s.name || fallback.name || 'Invocador'),
        tag: String(s.tag || fallback.tag || ''),
        level: Number(s.level || 0),
        region: String(s.region || fallback.region || 'LAS'),
        iconId: Number(s.iconId || 29)
      },
      rank: {
        tier: String(rank.tier || 'UNRANKED').toUpperCase(),
        division: String(rank.division || ''),
        lp: Number(rank.lp || 0),
        wins: Number(rank.wins || 0),
        losses: Number(rank.losses || 0)
      },
      matches: matches,
      demo: raw.demo === true,
      totalGames: matches.length
    };
  }

  function proxyProfile(baseUrl, summonerKey, region, options) {
    options = options || {};
    var base = String(baseUrl || '').replace(/\/+$/, '');
    if (!base) return Promise.reject(new Error('Falta la URL del proxy'));
    var identity = splitSummoner(summonerKey);
    var url = base + '/profile?gameName=' + encodeURIComponent(identity.name) +
      '&tagLine=' + encodeURIComponent(identity.tag) +
      '&region=' + encodeURIComponent(region || 'LAS');

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, options.timeoutMs || 8000) : null;

    return fetch(url, {
      signal: controller ? controller.signal : undefined,
      headers: { Accept: 'application/json' }
    }).then(function (response) {
      if (timer) clearTimeout(timer);
      if (!response.ok) throw new Error('El proxy respondió ' + response.status);
      return response.json();
    }).then(function (payload) {
      return normalizeProfile(payload, { name: identity.name, tag: identity.tag, region: region });
    }).catch(function (error) {
      if (timer) clearTimeout(timer);
      throw error;
    });
  }

  function fetchDragonVersion() {
    if (typeof fetch !== 'function') return Promise.resolve(FALLBACK_VERSION);
    return fetch(DDRAGON + '/api/versions.json', { cache: 'force-cache' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (list) { return (Array.isArray(list) && list[0]) || FALLBACK_VERSION; })
      .catch(function () { return FALLBACK_VERSION; });
  }

  // ── Render ───────────────────────────────────────────────────

  function readStore(key) {
    try { return window.localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }

  function writeStore(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* modo privado */ }
  }

  function initialsOf(tier) {
    var text = String(tier || '?');
    return text.slice(0, 1).toUpperCase();
  }

  function rankEmblem(rank) {
    var color = tierColor(rank.tier);
    var division = rank.division ? ' ' + escapeHtml(rank.division) : '';
    return '' +
      '<div class="lol-rank" style="--rank-color:' + color + '">' +
        '<span class="lol-rank__gem" aria-hidden="true">' + escapeHtml(initialsOf(rank.tier)) + '</span>' +
        '<span class="lol-rank__tier">' + escapeHtml(rank.tier) + division + '</span>' +
        '<span class="lol-rank__lp">' + escapeHtml(rank.lp) + ' LP</span>' +
      '</div>';
  }

  function formStrip(results) {
    if (!results.length) {
      return '<p class="lol-empty-inline">Sin partidas recientes.</p>';
    }
    var items = form(results, 10).map(function (r) {
      var cls = r === 'W' ? 'is-win' : 'is-loss';
      return '<span class="lol-form__chip ' + cls + '" title="' + (r === 'W' ? 'Victoria' : 'Derrota') + '">' + r + '</span>';
    }).join('');
    return '<div class="lol-form">' + items + '</div>';
  }

  function roleBars(rows) {
    if (!rows.length) return '<p class="lol-empty-inline">Sin datos de rol.</p>';
    return '<ul class="lol-roles">' + rows.map(function (row) {
      var width = Math.round(clamp(row.winrate, 0, 1) * 100);
      return '' +
        '<li class="lol-role">' +
          '<span class="lol-role__name">' + escapeHtml(row.role) + '</span>' +
          '<span class="lol-role__bar"><span class="lol-role__fill" style="width:' + width + '%"></span></span>' +
          '<span class="lol-role__value">' + pct(row.winrate) + ' <em>' + row.games + 'P</em></span>' +
        '</li>';
    }).join('') + '</ul>';
  }

  function championCards(rows, version) {
    if (!rows.length) return '<p class="lol-empty-inline">Sin campeones jugados.</p>';
    return '<div class="lol-champs">' + rows.slice(0, 8).map(function (row) {
      var wr = pct(row.winrate);
      return '' +
        '<article class="lol-champ">' +
          '<img class="lol-champ__icon" src="' + championIcon(row.champion, version) + '" alt="' + escapeHtml(row.champion) + '" loading="lazy" onerror="this.classList.add(\'is-broken\')">' +
          '<div class="lol-champ__body">' +
            '<h4 class="lol-champ__name">' + escapeHtml(row.champion) + '</h4>' +
            '<p class="lol-champ__meta"><span>' + row.games + 'P</span><span>' + wr + ' WR</span><span>' + row.kda.toFixed(2) + ' KDA</span></p>' +
          '</div>' +
        '</article>';
    }).join('') + '</div>';
  }

  function matchRows(matches, version) {
    if (!matches.length) return '<p class="lol-empty-inline">Todavía no hay partidas.</p>';
    return '<ol class="lol-matches">' + matches.map(function (m) {
      var win = m.result === 'W';
      return '' +
        '<li class="lol-match ' + (win ? 'is-win' : 'is-loss') + '">' +
          '<img class="lol-match__icon" src="' + championIcon(m.champion, version) + '" alt="" loading="lazy" onerror="this.classList.add(\'is-broken\')">' +
          '<div class="lol-match__champ"><strong>' + escapeHtml(m.champion) + '</strong><span>' + escapeHtml(m.role) + '</span></div>' +
          '<div class="lol-match__result">' + (win ? 'Victoria' : 'Derrota') + '</div>' +
          '<div class="lol-match__kda">' + m.kills + '/' + m.deaths + '/' + m.assists + '</div>' +
          '<div class="lol-match__meta"><span>' + m.cs + ' CS</span><span>' + duration(m.duration) + '</span><span>' + escapeHtml(timeAgo(m.playedAt)) + '</span></div>' +
        '</li>';
    }).join('') + '</ol>';
  }

  function summaryCards(profile) {
    var rank = profile.rank;
    var wr = winrate(rank.wins, rank.losses);
    var last = streak(profile.matches.map(function (m) { return m.result; }));
    var avgKda = profile.matches.length
      ? profile.matches.reduce(function (acc, m) { return acc + kda(m.kills, m.deaths, m.assists); }, 0) / profile.matches.length
      : 0;
    var streakText = last.type ? (last.type === 'W' ? last.count + ' victorias' : last.count + ' derrotas') : '—';

    return '' +
      '<div class="lol-summary">' +
        '<div class="lol-stat"><span class="lol-stat__label">Winrate</span><strong class="lol-stat__value">' + pct(wr) + '</strong><span class="lol-stat__hint">' + rank.wins + 'V · ' + rank.losses + 'D</span></div>' +
        '<div class="lol-stat"><span class="lol-stat__label">KDA promedio</span><strong class="lol-stat__value">' + avgKda.toFixed(2) + '</strong><span class="lol-stat__hint">últimas ' + profile.matches.length + ' partidas</span></div>' +
        '<div class="lol-stat"><span class="lol-stat__label">Racha</span><strong class="lol-stat__value ' + (last.type === 'W' ? 'is-win' : (last.type === 'L' ? 'is-loss' : '')) + '">' + escapeHtml(streakText) + '</strong><span class="lol-stat__hint">' + escapeHtml(profile.summoner.region) + '</span></div>' +
      '</div>';
  }

  function hero(profile, version) {
    var main = championStats(profile.matches)[0];
    var splash = main ? championSplash(main.champion) : '';
    var style = splash ? ' style="--splash:url(\'' + splash.replace(/'/g, '%27') + '\')"' : '';
    return '' +
      '<section class="lol-hero"' + style + '>' +
        '<div class="lol-hero__art" aria-hidden="true"></div>' +
        '<div class="lol-hero__body">' +
          '<img class="lol-hero__avatar" src="' + profileIcon(profile.summoner.iconId, version) + '" alt="Icono de invocador" onerror="this.classList.add(\'is-broken\')">' +
          '<div class="lol-hero__id">' +
            '<h2 class="lol-hero__name">' + escapeHtml(profile.summoner.name) +
              (profile.summoner.tag ? '<span class="lol-hero__tag">#' + escapeHtml(profile.summoner.tag) + '</span>' : '') +
            '</h2>' +
            '<p class="lol-hero__meta">' + (profile.summoner.level > 0 ? 'Nivel ' + profile.summoner.level + ' · ' : '') + escapeHtml(profile.summoner.region) +
              (profile.demo ? ' · <span class="lol-demo">datos demo</span>' : '') +
            '</p>' +
          '</div>' +
          rankEmblem(profile.rank) +
        '</div>' +
      '</section>';
  }

  function shell(state) {
    var options = REGIONS.map(function (r) {
      return '<option value="' + r + '"' + (r === state.region ? ' selected' : '') + '>' + r + '</option>';
    }).join('');
    return '' +
      '<form class="lol-search" data-lol="form" novalidate>' +
        '<label class="lol-search__field">' +
          '<span class="lol-search__label">Invocador</span>' +
          '<input class="lol-search__input" data-lol="name" type="text" name="summoner" placeholder="Nombre#TAG" autocomplete="off" spellcheck="false" value="' + escapeHtml(state.lastKey || '') + '" required>' +
        '</label>' +
        '<label class="lol-search__field lol-search__field--region">' +
          '<span class="lol-search__label">Región</span>' +
          '<select class="lol-search__input" data-lol="region" name="region">' + options + '</select>' +
        '</label>' +
        '<button class="lol-search__go" type="submit">Analizar</button>' +
      '</form>' +
      '<p class="lol-search__hint" data-lol="hint">' + (state.proxy ? 'Consultando el proxy configurado.' : 'Modo demo: los datos son de ejemplo, no de Riot.') + '</p>' +
      '<details class="lol-proxy">' +
        '<summary class="lol-proxy__summary">Conectar datos reales</summary>' +
        '<form class="lol-proxy__form" data-lol="proxyForm">' +
          '<label class="lol-search__field lol-proxy__field">' +
            '<span class="lol-search__label">URL del servicio de datos</span>' +
            '<input class="lol-search__input" data-lol="proxyUrl" type="url" placeholder="https://datos.tu-sitio.com" value="' + escapeHtml(state.proxy) + '">' +
          '</label>' +
          '<button class="lol-search__go" type="submit">Guardar</button>' +
          '<button class="lol-proxy__clear" type="button" data-lol="proxyClear">Quitar</button>' +
        '</form>' +
        '<p class="lol-proxy__note">No hay nada que instalar: la página consulta un servicio que guarda la clave de Riot del lado del servidor. Sin servicio configurado, ves datos de demostración.</p>' +
        '<p class="lol-proxy__note">Avanzado, solo en tu máquina: <code>tools/lcu-bridge.mjs</code> lee tu propio cliente de LoL.</p>' +
      '</details>' +
      '<div class="lol-status" data-lol="status" role="status" aria-live="polite"></div>' +
      '<div class="lol-view" data-lol="view"></div>';
  }

  function renderView(state) {
    if (state.status === 'loading') {
      return '<div class="lol-skeleton" aria-hidden="true"><div class="lol-skeleton__hero"></div><div class="lol-skeleton__row"></div><div class="lol-skeleton__row"></div><div class="lol-skeleton__row"></div></div>';
    }
    if (state.status === 'error') {
      return '<div class="lol-error" role="alert"><strong>No se pudo cargar el perfil.</strong><p>' + escapeHtml(state.error) + '</p></div>';
    }
    if (!state.profile) {
      return '<div class="lol-empty"><p>Escribí un invocador y presioná <b>Analizar</b>.</p><p class="lol-empty__sub">Ejemplo: <code>Katarina#LAS</code></p></div>';
    }
    var profile = state.profile;
    var results = profile.matches.map(function (m) { return m.result; });
    return '' +
      (state.notice ? '<p class="lol-notice" role="status">' + escapeHtml(state.notice) + '</p>' : '') +
      hero(profile, state.version) +
      summaryCards(profile) +
      '<section class="lol-panel"><h3 class="lol-panel__title">Forma reciente</h3>' + formStrip(results) + '</section>' +
      '<div class="lol-grid">' +
        '<section class="lol-panel"><h3 class="lol-panel__title">Roles</h3>' + roleBars(roleStats(profile.matches)) + '</section>' +
        '<section class="lol-panel"><h3 class="lol-panel__title">Campeones</h3>' + championCards(championStats(profile.matches), state.version) + '</section>' +
      '</div>' +
      '<section class="lol-panel"><h3 class="lol-panel__title">Historial</h3>' + matchRows(profile.matches, state.version) + '</section>';
  }

  function mount(root, options) {
    if (!root || !root.querySelector) throw new Error('LoLProfile.mount: contenedor inválido');
    options = options || {};

    var state = {
      status: 'idle',
      error: '',
      profile: null,
      version: options.version || FALLBACK_VERSION,
      region: options.region || 'LAS',
      proxy: options.proxyUrl || readStore(STORE_PROXY) || DEFAULT_PROXY,
      notice: '',
      lastKey: readStore(STORE_LAST) || ''
    };

    root.innerHTML = shell(state);

    var view = root.querySelector('[data-lol="view"]');
    var statusEl = root.querySelector('[data-lol="status"]');
    var formEl = root.querySelector('[data-lol="form"]');
    var nameEl = root.querySelector('[data-lol="name"]');
    var regionEl = root.querySelector('[data-lol="region"]');
    var hintEl = root.querySelector('[data-lol="hint"]');

    function paint() {
      view.innerHTML = renderView(state);
      if (statusEl) {
        statusEl.textContent = state.status === 'loading' ? 'Cargando perfil…' : (state.status === 'error' ? state.error : '');
      }
    }

    function search(rawKey) {
      var key = String(rawKey || '').trim();
      if (!isValidSummoner(key)) {
        state.status = 'error';
        state.error = 'Formato inválido. Usá Nombre#TAG, por ejemplo Katarina#LAS.';
        paint();
        return Promise.resolve(null);
      }
      state.status = 'loading';
      state.error = '';
      paint();
      writeStore(STORE_LAST, key);
      state.lastKey = key;

      var loader = state.proxy
        ? proxyProfile(state.proxy, key, state.region, { timeoutMs: options.timeoutMs })
        : Promise.resolve(demoProfile(key, state.region));

      return loader.then(function (profile) {
        state.profile = normalizeProfile(profile, splitSummoner(key));
        state.status = 'ready';
        paint();
        return state.profile;
      }).catch(function (error) {
        // Si el servicio de datos falla, seguimos mostrando demo en vez de una
        // pantalla rota. El aviso deja claro que no son datos reales.
        if (state.proxy) {
          state.profile = normalizeProfile(demoProfile(key, state.region), splitSummoner(key));
          state.status = 'ready';
          state.notice = 'El servicio de datos no respondió (' + ((error && error.message) || 'error') + '). Mostrando datos de ejemplo.';
          paint();
          return state.profile;
        }
        state.profile = null;
        state.status = 'error';
        state.error = (error && error.message) || 'Error desconocido';
        paint();
        return null;
      });
    }

    if (formEl) {
      formEl.addEventListener('submit', function (event) {
        event.preventDefault();
        var value = nameEl ? nameEl.value : '';
        if (regionEl) state.region = regionEl.value;
        search(value);
      });
    }

    if (regionEl) {
      regionEl.addEventListener('change', function () {
        state.region = regionEl.value;
        if (state.profile) search(state.lastKey || state.profile.summoner.name + '#' + state.profile.summoner.tag);
      });
    }

    var proxyForm = root.querySelector('[data-lol="proxyForm"]');
    var proxyInput = root.querySelector('[data-lol="proxyUrl"]');
    var proxyClear = root.querySelector('[data-lol="proxyClear"]');

    function updateHint() {
      if (!hintEl) return;
      hintEl.textContent = state.proxy
        ? 'Datos reales a través del servicio configurado.'
        : 'Modo demo: los datos son de ejemplo, no de Riot.';
    }

    if (proxyForm) {
      proxyForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var value = proxyInput ? proxyInput.value.trim() : '';
        if (value && !/^https?:\/\//i.test(value)) {
          state.status = 'error';
          state.error = 'La URL del proxy debe empezar con http:// o https://';
          paint();
          return;
        }
        state.proxy = value.replace(/\/+$/, '');
        writeStore(STORE_PROXY, state.proxy);
        if (proxyInput) proxyInput.value = state.proxy;
        updateHint();
        if (state.lastKey) search(state.lastKey);
      });
    }

    if (proxyClear) {
      proxyClear.addEventListener('click', function () {
        state.proxy = '';
        writeStore(STORE_PROXY, '');
        if (proxyInput) proxyInput.value = '';
        updateHint();
        if (state.lastKey) search(state.lastKey);
      });
    }

    updateHint();

    fetchDragonVersion().then(function (version) {
      state.version = version;
      if (state.status === 'ready') paint();
    });

    if (options.autoLoad !== false) {
      var initial = state.lastKey || options.initialSummoner || 'Katarina#LAS';
      if (nameEl) nameEl.value = initial;
      search(initial);
    } else {
      paint();
    }

    return {
      search: search,
      destroy: function () { root.innerHTML = ''; },
      _debug: function () { return { state: JSON.parse(JSON.stringify(state)) }; }
    };
  }

  return {
    mount: mount,
    demoProfile: demoProfile,
    proxyProfile: proxyProfile,
    normalizeProfile: normalizeProfile,
    normalizeMatch: normalizeMatch,
    winrate: winrate,
    pct: pct,
    kda: kda,
    duration: duration,
    streak: streak,
    form: form,
    timeAgo: timeAgo,
    roleStats: roleStats,
    championStats: championStats,
    isValidSummoner: isValidSummoner,
    splitSummoner: splitSummoner,
    championIcon: championIcon,
    championSplash: championSplash,
    profileIcon: profileIcon,
    tierColor: tierColor,
    escapeHtml: escapeHtml,
    REGIONS: REGIONS,
    FALLBACK_VERSION: FALLBACK_VERSION
  };
});
