/*!
 * lol-ui.js v1.0.0 — interfaz de las tres herramientas + navegación por pestañas.
 *
 * Monta: Perfil (usa LoLProfile), Draft, Progreso y Análisis.
 * Toda la lógica vive en lol-core.js; acá solo hay DOM.
 */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var esc = function (v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  var core = window.LoLCore;
  var champions = [];
  var profileMounted = false;

  function bridgeUrl() {
    try { return (localStorage.getItem('gn:lol:proxy') || '').replace(/\/+$/, ''); } catch (error) { return ''; }
  }

  function fetchBridge(path) {
    var base = bridgeUrl();
    if (!base) return Promise.reject(new Error('Primero pegá la URL del puente en la pestaña Perfil.'));
    return fetch(base + path).then(function (response) {
      if (!response.ok) throw new Error('El puente respondió ' + response.status);
      return response.json();
    });
  }

  function showError(target, message) {
    var out = $(target);
    if (out) out.innerHTML = '<div class="lol-error" role="alert">' + esc(message) + '</div>';
  }

  // ── Pestañas ────────────────────────────────────────────────

  function activate(name) {
    $$('[data-tab]').forEach(function (btn) {
      var on = btn.getAttribute('data-tab') === name;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('[data-panel]').forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-panel') !== name;
    });
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    if (name === 'perfil' && !profileMounted && window.LoLProfile) {
      var root = $('#lolRoot');
      if (root) { window.LoLProfile.mount(root, { region: 'LAS' }); profileMounted = true; }
    }
  }

  // ── Draft ───────────────────────────────────────────────────

  function championOptions(selected) {
    return '<option value="">—</option>' + champions.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === selected ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');
  }

  function buildDraftForm() {
    var form = $('[data-draft="form"]');
    if (!form || form.getAttribute('data-built') === '1') return;
    var slots = [
      { side: 'ally', index: 0, label: 'Vos' },
      { side: 'ally', index: 1, label: 'Aliado 1' },
      { side: 'ally', index: 2, label: 'Aliado 2' },
      { side: 'ally', index: 3, label: 'Aliado 3' },
      { side: 'ally', index: 4, label: 'Aliado 4' },
      { side: 'enemy', index: 0, label: 'Rival 1' },
      { side: 'enemy', index: 1, label: 'Rival 2' },
      { side: 'enemy', index: 2, label: 'Rival 3' },
      { side: 'enemy', index: 3, label: 'Rival 4' },
      { side: 'enemy', index: 4, label: 'Rival 5' }
    ];
    form.innerHTML = '<div class="lol-draft-grid">' + slots.map(function (s) {
      return '<label class="lol-draft-slot"><span class="lol-search__label">' + esc(s.label) + '</span>' +
        '<select class="lol-search__input" data-side="' + s.side + '" data-index="' + s.index + '">' +
        championOptions('') + '</select></label>';
    }).join('') + '</div>' +
      '<div class="lol-draft-actions">' +
        '<button class="lol-search__go" type="submit">Analizar draft</button>' +
        '<button class="lol-proxy__clear" type="button" data-draft="lcu">Leer champ select</button>' +
        '<button class="lol-proxy__clear" type="button" data-draft="demo">Cargar ejemplo</button>' +
      '</div>';
    form.setAttribute('data-built', '1');

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      renderDraft(readDraftForm());
    });
    form.addEventListener('click', function (event) {
      if (event.target.closest('[data-draft="demo"]')) {
        fillDraft(core.demoDraft());
        renderDraft(core.demoDraft());
        return;
      }
      if (event.target.closest('[data-draft="lcu"]')) {
        fetchBridge('/draft').then(function (live) {
          if (!live || !live.allies || !live.allies.length) {
            showError('[data-draft="out"]', 'No hay champ select en curso. Abrí una partida en el cliente y probá de nuevo.');
            return;
          }
          fillDraft(live);
          renderDraft(readDraftForm());
        }).catch(function (error) {
          showError('[data-draft="out"]', error.message);
        });
      }
    });
  }

  function readDraftForm() {
    var draft = { allies: [], enemies: [] };
    $$('[data-side]').forEach(function (select) {
      var id = select.value;
      if (!id) return;
      var champ = champions.filter(function (c) { return c.id === id; })[0] || { id: id, name: id, tags: [], info: {}, stats: {} };
      draft[select.getAttribute('data-side')].push(champ);
    });
    return draft;
  }

  function fillDraft(demo) {
    (demo.allies || []).forEach(function (c, i) {
      var select = $('[data-side="ally"][data-index="' + i + '"]');
      if (select) select.value = c.id;
    });
    (demo.enemies || []).forEach(function (c, i) {
      var select = $('[data-side="enemy"][data-index="' + i + '"]');
      if (select) select.value = c.id;
    });
  }

  function renderDraft(draft) {
    var out = $('[data-draft="out"]');
    if (!out || !core) return;
    var result = core.analyzeDraft(draft);
    var c = result.counts;
    var findings = result.findings.length ? result.findings.map(function (f) {
      return '<li class="lol-finding lol-finding--' + f.level.toLowerCase() + '">' +
        '<span class="lol-finding__level">' + f.level + '</span>' +
        '<div><strong>' + esc(f.title) + '</strong><p>' + esc(f.detail) + '</p></div></li>';
    }).join('') : '<li class="lol-empty-inline">Sin alertas: la composición está balanceada.</li>';

    out.innerHTML =
      '<div class="lol-summary">' +
        '<div class="lol-stat"><span class="lol-stat__label">Primera línea</span><strong class="lol-stat__value">' + c.frontline + '</strong><span class="lol-stat__hint">tanques o bruisers</span></div>' +
        '<div class="lol-stat"><span class="lol-stat__label">Inicio de pelea</span><strong class="lol-stat__value">' + c.engage + '</strong><span class="lol-stat__hint">campeones con engage</span></div>' +
        '<div class="lol-stat"><span class="lol-stat__label">Daño</span><strong class="lol-stat__value">' + c.ad + ' AD · ' + c.ap + ' AP</strong><span class="lol-stat__hint">' + c.hybrid + ' híbridos</span></div>' +
      '</div>' +
      '<section class="lol-panel"><h3 class="lol-panel__title">Condición de victoria</h3><p>' + esc(result.winCondition) + '</p>' +
        '<ul class="lol-plan">' + result.plan.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></section>' +
      '<section class="lol-panel"><h3 class="lol-panel__title">Alertas del draft</h3><ul class="lol-findings">' + findings + '</ul></section>';
  }

  // ── Progreso ────────────────────────────────────────────────

  function renderProgress(matches) {
    var out = $('[data-progress="out"]');
    if (!out || !core) return;
    var s = core.summarizeProgress(matches);
    if (!s.games) {
      out.innerHTML = '<p class="lol-empty-inline">Pegá un historial o cargá el ejemplo.</p>';
      return;
    }
    var trend = s.trend || { csPerMin: 0, deaths: 0, winrate: 0 };
    function arrow(value, invert) {
      var good = invert ? value < 0 : value > 0;
      if (Math.abs(value) < 0.01) return '=';
      return good ? '↑' : '↓';
    }
    out.innerHTML =
      '<div class="lol-summary">' +
        '<div class="lol-stat"><span class="lol-stat__label">Partidas</span><strong class="lol-stat__value">' + s.games + '</strong><span class="lol-stat__hint">winrate ' + Math.round(s.winrate * 100) + '%</span></div>' +
        '<div class="lol-stat"><span class="lol-stat__label">' + (s.csGames ? 'CS/min' : 'Visión/min') + '</span><strong class="lol-stat__value">' +
          (s.csGames ? s.csPerMin.toFixed(1) + ' ' + arrow(trend.csPerMin) : s.visionPerMin.toFixed(2)) +
          '</strong><span class="lol-stat__hint">' + (s.csGames ? 'tendencia reciente' : 'rol support') + '</span></div>' +
        '<div class="lol-stat"><span class="lol-stat__label">Muertes</span><strong class="lol-stat__value">' + s.deaths.toFixed(1) + ' ' + arrow(trend.deaths, true) + '</strong><span class="lol-stat__hint">por partida</span></div>' +
      '</div>' +
      (s.tilt ? '<div class="lol-alert" role="alert">' + esc(s.tilt) + '</div>' : '') +
      '<section class="lol-panel"><h3 class="lol-panel__title">Por campeón</h3><ul class="lol-roles">' +
        s.byChampion.slice(0, 6).map(function (c) {
          return '<li class="lol-role"><span class="lol-role__name">' + esc(c.champion) + '</span>' +
            '<span class="lol-role__bar"><span class="lol-role__fill" style="width:' + Math.round(c.winrate * 100) + '%"></span></span>' +
            '<span class="lol-role__value">' + Math.round(c.winrate * 100) + '% <em>' + c.games + 'P</em></span></li>';
        }).join('') + '</ul></section>' +
      '<section class="lol-panel"><h3 class="lol-panel__title">Por parche</h3><ul class="lol-roles">' +
        s.byPatch.map(function (p) {
          return '<li class="lol-role"><span class="lol-role__name">' + esc(p.patch) + '</span>' +
            '<span class="lol-role__bar"><span class="lol-role__fill" style="width:' + Math.round(p.winrate * 100) + '%"></span></span>' +
            '<span class="lol-role__value">' + Math.round(p.winrate * 100) + '% <em>' + p.games + 'P</em></span></li>';
        }).join('') + '</ul></section>';
  }

  function readJson(text, fallback) {
    try { return JSON.parse(text); } catch (error) { return fallback; }
  }

  // ── Análisis ────────────────────────────────────────────────

  function renderAnalysis(match) {
    var out = $('[data-analysis="out"]');
    if (!out || !core) return;
    var r = core.analyzeMatch(match);
    var label = r.score >= 75 ? 'Buena' : (r.score >= 50 ? 'Mejorable' : 'Para revisar');
    out.innerHTML =
      '<div class="lol-summary">' +
        '<div class="lol-stat"><span class="lol-stat__label">Puntaje</span><strong class="lol-stat__value">' + r.score + '/100</strong><span class="lol-stat__hint">' + label + '</span></div>' +
        '<div class="lol-stat"><span class="lol-stat__label">CS/min</span><strong class="lol-stat__value">' + r.metrics.csPerMin.toFixed(1) + '</strong><span class="lol-stat__hint">' + esc(r.match.champion) + '</span></div>' +
        '<div class="lol-stat"><span class="lol-stat__label">KDA</span><strong class="lol-stat__value">' + r.metrics.kda.toFixed(2) + '</strong><span class="lol-stat__hint">' + r.match.kills + '/' + r.match.deaths + '/' + r.match.assists + '</span></div>' +
      '</div>' +
      '<section class="lol-panel"><h3 class="lol-panel__title">Qué pasó</h3><ul class="lol-findings">' +
        (r.findings.length ? r.findings.map(function (f) {
          return '<li class="lol-finding lol-finding--' + f.level.toLowerCase() + '">' +
            '<span class="lol-finding__level">' + f.level + '</span>' +
            '<div><strong>' + esc(f.title) + '</strong><p>' + esc(f.detail) + '</p></div></li>';
        }).join('') : '<li class="lol-empty-inline">Sin hallazgos: partida limpia.</li>') +
      '</ul></section>';
  }

  // ── Extras ──────────────────────────────────────────────────

  function renderExtras() {
    var out = $('[data-extras="out"]');
    if (!out) return;
    var base = bridgeUrl();
    if (!base) { out.innerHTML = '<p class="lol-empty-inline">Configurá la URL del servicio en la pestaña Perfil.</p>'; return; }
    var last = '';
    try { last = localStorage.getItem('gn:lol:last') || ''; } catch (error) { last = ''; }
    var parts = last.split('#');
    var url = base + '/extras?region=LAS' + (parts.length === 2
      ? '&gameName=' + encodeURIComponent(parts[0]) + '&tagLine=' + encodeURIComponent(parts[1]) : '');
    out.innerHTML = '<p class="lol-empty-inline">Consultando…</p>';
    fetch(url).then(function (response) { return response.json(); }).then(function (data) {
      function card(label, value) {
        return '<div class="lol-stat"><span class="lol-stat__label">' + esc(label) + '</span><strong class="lol-stat__value">' + esc(value) + '</strong></div>';
      }
      out.innerHTML = '<div class="lol-summary">' +
        card('Plataforma', data.status ? (data.status.incidents ? data.status.incidents + ' incidentes' : 'operativa') : 'sin dato') +
        card('Rotación gratuita', data.rotation ? data.rotation.free + ' campeones' : 'sin dato') +
        card('Desafíos', data.challenges ? data.challenges.total + ' puntos' : 'sin dato') +
        card('Partida en vivo', data.live ? (data.live.active ? 'sí · ' + data.live.mode : 'no') : 'sin invocador') +
        '</div>';
    }).catch(function (error) {
      out.innerHTML = '<div class="lol-error" role="alert">' + esc(error.message) + '</div>';
    });
  }

  // ── Datos crudos ────────────────────────────────────────────

  function renderDatos() {
    var out = $('[data-datos="out"]');
    var select = $('[data-datos="endpoint"]');
    var matchInput = $('[data-datos="matchId"]');
    if (!out || !select) return;
    var base = bridgeUrl();
    if (!base) { out.textContent = 'Configurá la URL del servicio en Perfil.'; return; }
    var last = '';
    try { last = localStorage.getItem('gn:lol:last') || ''; } catch (error) { last = ''; }
    var parts = last.split('#');
    var url = base + '/raw?endpoint=' + encodeURIComponent(select.value) + '&region=LAS' +
      (parts.length === 2 ? '&gameName=' + encodeURIComponent(parts[0]) + '&tagLine=' + encodeURIComponent(parts[1]) : '') +
      (matchInput && matchInput.value ? '&matchId=' + encodeURIComponent(matchInput.value.trim()) : '');
    out.textContent = 'Consultando…';
    fetch(url).then(function (response) { return response.json(); }).then(function (data) {
      out.textContent = JSON.stringify(data, null, 2);
    }).catch(function (error) {
      out.textContent = 'Error: ' + error.message;
    });
  }

  // ── Arranque ────────────────────────────────────────────────

  function bindForms() {
    var progressForm = $('[data-progress="form"]');
    if (progressForm) {
      progressForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var text = $('[data-progress="input"]').value;
        var data = readJson(text, null);
        if (!Array.isArray(data)) {
          $('[data-progress="out"]').innerHTML = '<div class="lol-error" role="alert">El historial tiene que ser un array JSON de partidas.</div>';
          return;
        }
        renderProgress(data);
      });
      progressForm.addEventListener('click', function (event) {
        if (event.target.closest('[data-progress="demo"]')) {
          var demo = core.demoMatches();
          $('[data-progress="input"]').value = JSON.stringify(demo, null, 2);
          renderProgress(demo);
          return;
        }
        if (event.target.closest('[data-progress="lcu"]')) {
          fetchBridge('/profile').then(function (perfil) {
            var matches = (perfil && perfil.matches) || [];
            $('[data-progress="input"]').value = JSON.stringify(matches, null, 2);
            renderProgress(matches);
          }).catch(function (error) {
            showError('[data-progress="out"]', error.message);
          });
        }
      });
    }

    var analysisForm = $('[data-analysis="form"]');
    if (analysisForm) {
      analysisForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var data = readJson($('[data-analysis="input"]').value, null);
        if (!data || typeof data !== 'object') {
          $('[data-analysis="out"]').innerHTML = '<div class="lol-error" role="alert">Pegá una partida en JSON.</div>';
          return;
        }
        renderAnalysis(data);
      });
      analysisForm.addEventListener('click', function (event) {
        if (!event.target.closest('[data-analysis="demo"]')) return;
        var demo = core.demoMatch();
        $('[data-analysis="input"]').value = JSON.stringify(demo, null, 2);
        renderAnalysis(demo);
      });
    }
  }

  function boot() {
    $$('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () { activate(btn.getAttribute('data-tab')); });
    });
    bindForms();

    document.addEventListener('click', function (event) {
      if (event.target && event.target.closest && event.target.closest('[data-extras="load"]')) renderExtras();
      if (event.target && event.target.closest && event.target.closest('[data-datos="load"]')) renderDatos();
      if (event.target && event.target.closest && event.target.closest('[data-analysis="auto"]')) {
        fetchBridge('/profile').then(function (perfil) {
          var matches = (perfil && perfil.matches) || [];
          if (!matches.length) throw new Error('No hay partidas para analizar.');
          activate('analisis');
          renderAnalysis(matches[0]);
        }).catch(function (error) {
          showError('[data-analysis="out"]', error.message);
        });
      }
    });

    // Clic en una partida del perfil: la manda al coach con sus eventos reales.
    document.addEventListener('click', function (event) {
      var row = event.target && event.target.closest ? event.target.closest('[data-analyze]') : null;
      if (!row) return;
      var list = window.__circeMatches || [];
      var match = list[Number(row.getAttribute('data-analyze'))];
      if (!match) return;
      activate('analisis');
      var input = $('[data-analysis="input"]');
      if (input) input.value = JSON.stringify(match, null, 2);
      renderAnalysis(match);
    });

    if (core) {
      core.fetchVersion().then(function (version) {
        return core.fetchChampions(version).catch(function () { return []; });
      }).then(function (list) {
        champions = list || [];
        buildDraftForm();
        if (!champions.length) {
          var out = $('[data-draft="out"]');
          if (out) out.innerHTML = '<p class="lol-empty-inline">No se pudo cargar la lista de campeones desde Data Dragon.</p>';
        }
      });
    }

    var initial = (location.hash || '#perfil').replace('#', '');
    activate(['perfil', 'draft', 'progreso', 'analisis'].indexOf(initial) >= 0 ? initial : 'perfil');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
