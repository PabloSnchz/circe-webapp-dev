# Circe — herramientas de League of Legends

Cuatro herramientas en una página estática, sin cuenta y sin tracking: todo
corre en el navegador.

| Pestaña | Qué hace |
|---|---|
| **Perfil** | Perfil de invocador: rango, winrate, forma, roles, campeones e historial |
| **Draft** | Analiza la composición: frontline, engage, daño, escalado, condición de victoria |
| **Progreso** | Tendencias personales: CS/min, muertes, winrate por campeón y parche, señal de tilt |
| **Análisis** | Coach post-partida: hallazgos con severidad y puntaje |

- **Sitio:** https://pablosnchz.github.io/circe-webapp-dev/
- **Stack:** HTML, CSS y JavaScript vanilla. Sin frameworks, sin build, sin backend.

## Estructura

```
index.html            la página con las cuatro pestañas
css/lol.css           estilos (prefijo .lol-, sin !important)
js/lol-profile.js     perfil de invocador + proveedores de datos
js/lol-core.js        motor: draft, progreso y coach (funciones puras)
js/lol-ui.js          interfaz de las tres herramientas
tests/                pruebas de los motores (node --test)
proxy/                proxy para la Riot API (Worker de Cloudflare)
```

## Correrlo

Es un sitio estático: alcanza con abrir `index.html` en el navegador.

```bash
python -m http.server 8080   # o cualquier servidor estático
```

## Tests

```bash
node --test "tests/**/*.test.js"
```

## Datos

| Fuente | Qué aporta | Clave |
|---|---|---|
| Data Dragon | Campeones, íconos, splash art | No |
| Riot API (vía proxy) | Invocador, rango, partidas | Sí |

Por defecto la página usa datos de demostración deterministas. Para datos
reales hay que desplegar `proxy/riot-proxy.mjs` y pegar su URL en el panel
**Datos reales** de la página. Instrucciones en [`proxy/README.md`](proxy/README.md).

## Publicación

GitHub Pages sirve `main` desde la raíz. Cada push a `main` republica el sitio.
