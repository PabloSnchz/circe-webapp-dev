# Circe — Perfil de invocador

Página estática de perfil de invocador de **League of Legends**, estilo
Porofessor con la estética de **Wild Rift**: rango, winrate, forma reciente,
roles, campeones e historial.

- **Sitio:** https://pablosnchz.github.io/circe-webapp-dev/
- **Stack:** HTML, CSS y JavaScript vanilla. Sin frameworks, sin build, sin backend.

## Estructura

```
index.html            la página
css/lol.css           estilos (prefijo .lol-, sin !important)
js/lol-profile.js     módulo: datos, render y proveedores
tests/                pruebas del módulo (node --test)
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
