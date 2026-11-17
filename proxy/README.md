# Proxy de la Riot API

La Riot API **no permite CORS desde el navegador** y `lol.html` es una página
estática. Este Worker resuelve eso: guarda la clave, consulta Riot y devuelve el
JSON ya normalizado que consume `js/lol-profile.js`.

## 1. Sacar la clave

1. Entrá a <https://developer.riotgames.com/> con tu cuenta de Riot.
2. Copiá la **Development API Key**.

> La clave de desarrollo **vence cada 24 horas** y tiene límites bajos
> (20 peticiones por segundo, 100 por 2 minutos). Alcanza para probar y para uso
> personal. Para un sitio público hace falta una **Production Key**, que se pide
> desde el mismo panel.

## 2. Desplegar el Worker (Cloudflare, plan gratuito)

```bash
npx wrangler deploy proxy/riot-proxy.mjs --name riot-proxy --compatibility-date=2024-11-01
npx wrangler secret put RIOT_API_KEY --name riot-proxy
```

Pegá la clave cuando lo pida. Al terminar, wrangler imprime una URL del tipo:

```
https://riot-proxy.tu-usuario.workers.dev
```

También funciona en Vercel o Netlify Functions: el archivo es un handler estándar
de Workers (`export default { fetch }`), y la lógica de Riot es portable.

## 3. Conectarlo en la página

Abrí `lol.html`, desplegá **Datos reales (opcional)** y pegá la URL del Worker.
Se guarda en `localStorage` bajo `gn:lol:proxy` y desde ahí todas las búsquedas
van a Riot.

## 4. Verificar

```bash
curl "https://TU-WORKER/health"
curl "https://TU-WORKER/profile?gameName=TuNombre&tagLine=LAS&region=LAS"
```

Si devuelve `{"error":"La clave de Riot no es válida o expiró"}`, renová la clave
del panel de Riot.

## Endpoints que usa

| Dato | Endpoint |
|---|---|
| Cuenta por Riot ID | `account-v1 /accounts/by-riot-id` |
| Invocador (nivel, ícono) | `summoner-v4 /summoners/by-puuid` |
| Rango | `league-v4 /entries/by-puuid` |
| Partidas | `match-v5 /matches/by-puuid/ids` + `/matches/{id}` |
| Íconos, splash, campeones | Data Dragon (sin clave, directo desde el navegador) |
