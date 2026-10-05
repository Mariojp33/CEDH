# cEDH Stats por comandante

Web pequeña que descarga torneos cEDH de la [API de TopDeck.gg](https://topdeck.gg/docs/tournaments-v2) y, para el comandante que elijas, muestra:

- Winrate, intervalo de confianza al 95 % y comparación con el 25 % neutro de una mesa de 4.
- Cartas asociadas a **más** y a **menos** winrate (diferencia entre los mazos que la juegan y los que no, con su estadístico z).
- Cartas más jugadas con ese comandante y su inclusión.
- **Matchups:** cómo rinde ese comandante cuando cada otro comandante del meta está en su mesa, y una matriz de los 12 más jugados.
- **Cartas contra un rival:** al hacer clic en un rival, qué cartas rinden mejor o peor en las mesas donde está. Muestra también el efecto general de la carta y el «exceso» (la diferencia entre ambos) para separar las cartas buenas contra ese rival de las que son buenas siempre.
- **Periodo:** 1, 3 o 6 meses (parámetro `days`). Se filtra en local sobre la caché.
- **Mapa de cartas:** popularidad frente a diferencia de winrate, con las cartas en cuatro cuadrantes. Las diferencias se muestran también *ajustadas* (encogidas según el tamaño de la muestra) y con una *fiabilidad* corregida por comparaciones múltiples.
- **Mi lista:** pega tu lista y compara con el meta de ese comandante: cartas a revisar, cartas muy jugadas que no llevas y opciones con buen rendimiento. Se recuerda en el navegador y permite copiar las cartas sugeridas.
- **Evolución en el tiempo:** winrate y presencia por periodos de 30 días, y cartas en ascenso o descenso.
- **Variantes:** agrupa los mazos de un comandante por las cartas que comparten y compara el winrate de cada grupo.
- **Sinergias:** pares de cartas que juntas rinden más (o menos) de lo que suman por separado.
- **Comparar** dos comandantes, tasa de **empates**, y **enlace compartible** (periodo, filtros y comandante van en la dirección).
- **Filtro por tamaño de torneo** (jugadores mín/máx) que afecta a todo lo anterior. Se aplica en local sobre la caché, así que cambiarlo no gasta peticiones a la API. También disponible como parámetros `minPlayers` y `maxPlayers` en todos los endpoints.

Sin dependencias: solo Node 20+.

## Uso

```bash
# Prueba sin clave (datos sintéticos)
MOCK=1 node server.js          # http://localhost:3000

# Con datos reales
export TOPDECK_API_KEY=tu_clave   # gratis en https://topdeck.gg/developers
node server.js

# Tests
npm test
```

La primera carga descarga `DAYS` días (por defecto 180) en ventanas de 7 días, incluyendo las rondas de cada torneo (necesarias para los matchups), y tarda unos minutos por los límites de la API; se guarda en `data/records.json`. Después se refrescan solo las últimas 2 semanas cada `REFRESH_HOURS` (6).

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `TOPDECK_API_KEY` | — | Clave de la API (obligatoria salvo `MOCK=1`) |
| `DAYS` | 180 | Histórico descargado (máximo elegible en la web) |
| `PARTICIPANT_MIN` | 16 | Mínimo de jugadores por torneo |
| `REFRESH_HOURS` | 6 | Frecuencia de actualización |
| `PORT` | 3000 | Puerto |
| `DATA_DIR` | `./data` | Dónde guardar la caché |

## Despliegue

Vale cualquier hosting de Node (Render, Railway, Fly.io…): comando de arranque `node server.js`, variable `TOPDECK_API_KEY` configurada en el panel del servicio. La clave nunca llega al navegador porque todas las llamadas a TopDeck las hace el servidor. Si el hosting borra el disco en cada despliegue, monta un volumen en `DATA_DIR` para no volver a descargar todo.

## Atribución

La API exige un crédito visible con enlace a TopDeck.gg en cualquier proyecto que la use; ya está en el pie de página de la web. Respétalo si modificas la interfaz.

## Cómo interpretar los números

- Es **correlación, no causalidad**: una carta puede aparecer más en mazos de jugadores mejores o con otro plan.
- Se comparan cientos de cartas a la vez, así que con |z| entre 2 y 3 es fácil que sea casualidad; por encima de ~3 es más fiable.
- Las cartas que casi todos juegan no tienen mazos "sin ella" con los que comparar y aparecen como `core`.
- Los empates cuentan como partida no ganada.
- **Diferencia ajustada y fiabilidad:** la ajustada acerca a 0 las diferencias con poca muestra; la fiabilidad (q de Benjamini-Hochberg) estima la probabilidad de que sea casualidad al mirar cientos de cartas. Ninguna separa «la carta gana» de «los buenos jugadores la llevan»: no se guarda la posición final de cada jugador.
- **Sinergias:** dos cartas del mismo plan de juego salen juntas siempre y pueden parecer una sinergia sin serlo; mira también las variantes.
- **Matchups:** la unidad es «un mazo en una mesa» (gana 1 de 4). Comparar «con el rival en la mesa» frente a «sin él» arrastra también quién más se sienta; una diferencia pequeña puede ser composición de mesa y no el rival. Las mesas de un mismo torneo no son independientes, así que z es orientativo.
- Con filtros de tamaño estrechos la muestra baja deprisa: las tablas piden un mínimo de mesas (15 por defecto) con y sin la carta o el rival.

## Endpoints

`/api/status`, `/api/commanders`, `/api/commander?name=`, `/api/matchups?name=`, `/api/matrix?top=`, `/api/cards-vs?name=&vs=`, `/api/trend?name=`, `/api/synergy?name=`, `/api/variants?name=&k=` y `POST /api/mylist` (`{commander, list}`). Todos aceptan `minPlayers`, `maxPlayers` y `days` (salvo `trend`, que usa todo el histórico).

## Estructura

- `lib/topdeck.js` — cliente de la API (ventanas de fechas, reintento ante 429).
- `lib/parse.js` — lectura de `decklist` (texto) y `deckObj`.
- `lib/stats.js` — winrate por comandante y diferencia por carta.
- `lib/mock.js` — torneos sintéticos con efectos conocidos, usados en los tests.
- `server.js` + `public/index.html` — servidor y frontend.

## Comprobación contra la API real

`TOPDECK_API_KEY=tu_clave npm run check` hace una sola petición (últimos 3 días, `DAYS=14` para más) e imprime solo estructura y recuentos: formato de `deckObj`, porcentaje de listas utilizables, estados y tamaños de mesa, y si los jugadores de las mesas se encuentran en la clasificación. No muestra la clave ni nombres de jugadores. `node scripts/check.js --mock` prueba el propio script con datos sintéticos.
