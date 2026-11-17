# AGENTS.md — circe-webapp-dev

Proyecto: página de perfil de invocador de League of Legends, estática.

## Stack

- HTML, CSS y JavaScript vanilla. **Sin frameworks, sin build, sin backend.**
- Un módulo por archivo, expuesto en `window.*` con un IIFE.
- Deploy: GitHub Pages desde `main`, raíz del repo.

## Comandos

| Acción | Comando |
|---|---|
| Tests | `node --test "tests/**/*.test.js"` |
| Servir local | `python -m http.server 8080` |
| Publicar | push a `main` (Pages republica solo) |

## Reglas

- Sin `!important`. Selectores nuevos con prefijo `.lol-`.
- Todo texto interpolado pasa por `escapeHtml`.
- Las funciones puras se exportan para poder testearlas sin DOM ni red.
- Nada de claves en el cliente: las credenciales viven en el proxy.
- No se tocan otros repositorios: `circe-dashboard` es el tablero; los de
  Shiruvana son territorio ajeno.

## Datos

- Data Dragon: sin clave, CORS abierto.
- Riot API: requiere clave y no permite CORS, por eso pasa por `proxy/`.
