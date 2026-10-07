# cEDH Stats por comandante

Web pequeña que descarga torneos cEDH de la [API de TopDeck.gg](https://topdeck.gg/docs/tournaments-v2) y, para el comandante que elijas, muestra:

- Winrate, intervalo de confianza al 95 % y comparación con la **media del meta** del periodo elegido (que ya incluye el efecto de los empates; el azar puro en mesas de 4 sería 25 %). Los «pts» son puntos de winrate; solo se colorean cuando el intervalo no incluye la media.
- Cartas asociadas a **más** y a **menos** winrate (diferencia entre los mazos que la juegan y los que no, con su estadístico z).
- Cartas más jugadas con ese comandante y su inclusión.
- **Matchups:** cómo rinde ese comandante cuando cada otro comandante del meta está en su mesa, y una matriz de los 12 más jugados.
- **Cartas contra un rival:** al hacer clic en un rival, qué cartas rinden mejor o peor en las mesas donde está. Muestra también el efecto general de la carta y el «exceso» (la diferencia entre ambos) para separar las cartas buenas contra ese rival de las que son buenas siempre.
- **Empates:** selector «Fuera del cálculo» (por defecto: winrate = victorias ÷ (victorias + derrotas), referencia ≈ 25 %) o «Cuentan como no ganadas» (victorias ÷ todas las partidas). La tasa de empates se muestra aparte. Afecta a todo, incluidos matchups y matriz: con empates fuera, solo cuentan las mesas con ganador y con todos los comandantes conocidos (≈80 % de las mesas con ganador).
- **Periodo:** 1, 3 o 6 meses (parámetro `days`). Se filtra en local sobre la caché.
- **Mapa de cartas:** popularidad frente a diferencia de winrate, con las cartas en cuatro cuadrantes. Las diferencias se muestran también *ajustadas* (encogidas según el tamaño de la muestra) y con una *fiabilidad* corregida por comparaciones múltiples.
- **Mi lista:** pega tu lista y obtienes un informe con solo datos de TopDeck: cuánto se parece tu lista al meta (cartas estándar, comunes, tech y raras), la variante del comandante más parecida, las listas reales más parecidas (torneo y récord, sin nombres de jugadores) y lo que te falta o te sobra **frente a las listas más parecidas a la tuya** (las que casi todas llevan y tú no, alternativas habituales y cartas poco habituales). Las recomendaciones reflejan lo que juegan listas parecidas, no el winrate asociado a cada carta: lo comprobamos con cambios reales de lista de los mismos jugadores (2.417 pares) y ese winrate no predice mejoras, así que daba consejos absurdos (revisar *Force of Will* o *Rhystic Study*). Se recuerda en el navegador y permite copiar las cartas sugeridas. Incluye un botón para copiar la lista y un enlace a [Commander Spellbook](https://commanderspellbook.com/find-my-combos/) para ver sus combos.
- **Meta del momento:** presencia de los comandantes mes a mes (barras apiladas), niveles S/A/B/C/D que salen del intervalo de confianza del winrate frente a la media (un mazo con pocas partidas no sube por suerte), quién sube y baja en presencia y la tasa de empates (global y por comandante). Describe resultados, no la fuerza del mazo.
- **Novedades:** cartas nuevas en el meta, en ascenso y en descenso (último mes frente a los dos anteriores, con prueba estadística y cambio mínimo de 2 puntos), con los comandantes donde más se juegan. Cada carta abre su ficha.
- **Alternativas a una carta** (dentro de «Buscar carta»): qué cartas llevan más los mazos de un comandante que no la juegan pero, por lo demás, se parecen a los que sí. Si no hay mazos parecidos sin la carta (los que no la llevan son otra versión del mazo), lo dice en vez de inventar alternativas.
- **Cartas a tener en cuenta** (arriba de la pestaña «Combos y amenazas» y resumidas en «Preparar mesa»): lo que **define** al mazo (cartas que lleva mucho más que el meta, sin tierras ni rocas de color) y, por función, **remates y motores**, **interacción y protección**, **tutores**, **maná rápido** e **impuestos y cartas de odio**: cuántas lleva de media frente al meta y cuáles (con su % de mazos). Las listas por función son de criterio y se editan en `lib/threats.js`; no dependen de ningún servicio externo, así que salen aunque Commander Spellbook falle. Mana Crypt, Jeweled Lotus y Dockside Extortionist (prohibidas en Commander) no figuran.
- **Combos y amenazas** (pestaña de cada comandante): combos de [Commander Spellbook](https://commanderspellbook.com) cruzados con los mazos de TopDeck. Se le pasan las cartas que el comandante juega en al menos el 10 % de sus mazos y devuelve los combos que caben; después se calcula cuántos mazos juegan realmente cada uno y se agrupan en **líneas** por su pieza clave (la menos común del combo), separando las que **ganan la partida** (p. ej. *Thassa's Oracle* + *Demonic Consultation* en Kraum, 97 %) de los **motores** que necesitan un remate (p. ej. *Hullbreaker Horror*, 83 % en Kinnan). Incluye las **piezas clave** (de qué preocuparse; sin las cartas que juega casi todo el meta) y los pasos de cada combo. La consulta a Spellbook solo se hace al abrir la pestaña; el resultado se guarda 24 h, las consultas simultáneas comparten una petición, cada IP tiene un máximo de 8 consultas nuevas por minuto y, si Spellbook falla, se usa la última respuesta buena. En «Preparar mesa» salen las amenazas de cada rival. Recoge combos infinitos y de victoria, no remates por valor ni victorias sin combo: «sin combo detectado» no significa inofensivo.
- **Preparar mesa:** eliges tu comandante y hasta tres rivales esperados; ves cómo le ha ido a tu comandante en las mesas donde estaban (con intervalo y z; solo se colorea con |z| ≥ 2 y avisa si hay menos de 15 mesas), las mesas con alguno de ellos y con todos a la vez, y qué cartas **distinguen** a cada rival (las que lleva mucho más que el meta en general, no Sol Ring ni Command Tower) más las que verás casi seguro. Es histórico, no una predicción: los matchups en cEDH suelen ser casi planos.
- **Núcleo y huecos de decisión** (dentro de cada variante, en «Variantes y paquetes»): cuántas cartas son fijas (80 % o más), cuántas plazas quedan abiertas y entre qué cartas candidatas se reparten (20-80 %), con el tech minoritario y un botón para copiar el núcleo como punto de partida de una lista. Solo uso, no resultados.
- **Buscar carta:** escribes una carta (con sugerencias) y ves en cuántos mazos cEDH se juega, en qué comandantes y con qué frecuencia, cómo ha evolucionado su uso mes a mes y qué cartas suelen acompañarla. Solo mira uso, no resultados. Va con un índice carta → mazos que se construye una sola vez al cargar o actualizar los datos (≈0,5 s y ≈15 MB), así que cada búsqueda tarda decenas de milisegundos.
- **Paquetes y alternativas:** dentro de un comandante, qué cartas se juegan juntas (combos y paquetes de un plan) y cuáles casi nunca coinciden (alternativas o planes distintos), medido solo por uso con el coeficiente phi. Sustituye a las antiguas «sinergias» por winrate de pares, que daban parejas sin sentido.
- **Solo torneos cEDH:** el formato «EDH» de TopDeck incluye torneos casuales, de precons, de presupuesto o brawl. Se descartan siempre, detectándolos por el contenido de los mazos (la mediana de cartas típicas de cEDH por mazo del torneo debe ser de 8 o más; en torneos cEDH reales ronda 20 y en los casuales 0-6), no por el nombre. La web avisa de cuántos se excluyen. `ALL_TOURNAMENTS=1` lo desactiva solo para depurar.
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
| `TOPDECK_API_KEY` | — | Clave de la API. Sin ella no hay actualización en directo (se usa solo el seed); `MOCK=1` prueba sin clave |
| `COMBOS_API` | API de Commander Spellbook | Dirección de la API de combos (para pruebas) |
| `SEED_URL` | release `seed` del repositorio | De dónde se descarga el seed al arrancar (vacío = no descargar) |
| `DAYS` | 180 | Histórico descargado (máximo elegible en la web) |
| `PARTICIPANT_MIN` | 16 | Mínimo de jugadores por torneo |
| `REFRESH_HOURS` | 6 | Frecuencia de actualización |
| `PORT` | 3000 | Puerto |
| `WINDOW_DAYS` | 3 | Días por petición al descargar (menos = menos memoria) |
| `ALL_TOURNAMENTS` | — | `1` incluye también los torneos que no parecen cEDH (solo depuración) |
| `DATA_DIR` | `./data` | Dónde guardar la caché |

## Renovar el seed automáticamente

`.github/workflows/update-seed.yml` renueva los datos cada 2 días (cron editable; a diario: `17 4 * * *`): parte del último seed publicado, descarga solo los días que faltan con `npm run seed:update`, comprueba que el resultado se lee y que no ha perdido datos (se aborta si pierde más del 10 %) y lo **publica como archivo de la release `seed`**, sobrescribiendo el anterior. No se hace ningún commit, así que el historial de git no crece. También se lanza a mano desde la pestaña Actions (Run workflow).

El servidor, al arrancar sin caché en disco, descarga ese seed (`SEED_URL`, por defecto `https://github.com/Mariojp33/CEDH/releases/download/seed/records.json`; vacío = desactivado) y, si no puede (no existe aún, error de red o archivo roto), usa la copia que hay en el repositorio (`seed/records.json`, renovable a mano con `npm run seed`). Como los datos viven fuera del código, **actualizarlos no obliga a redesplegar**.

Configuración:
- En GitHub (Settings → Secrets and variables → Actions → **Secrets**): `TOPDECK_API_KEY`. Y en Settings → Actions → General, permisos de flujo «Read and write».
- En Render (Environment): `TOPDECK_API_KEY`. La clave **no va en el código**. Sin ella el servidor no se cae: sirve los datos del seed y avisa de que no se actualiza.


## Despliegue

Vale cualquier hosting de Node (Render, Railway, Fly.io…): comando de arranque `node server.js`, variable `TOPDECK_API_KEY` configurada en el panel del servicio. La clave nunca llega al navegador porque todas las llamadas a TopDeck las hace el servidor. Si el hosting borra el disco en cada despliegue, monta un volumen en `DATA_DIR` para no volver a descargar todo.

## Atribución

La API exige un crédito visible con enlace a TopDeck.gg en cualquier proyecto que la use; ya está en el pie de página de la web. Respétalo si modificas la interfaz.

## Cómo interpretar los números

- Es **correlación, no causalidad**: una carta puede aparecer más en mazos de jugadores mejores o con otro plan.
- Se comparan cientos de cartas a la vez, así que con |z| entre 2 y 3 es fácil que sea casualidad; por encima de ~3 es más fiable.
- Las cartas que casi todos juegan no tienen mazos "sin ella" con los que comparar y aparecen como `core`.
- Los empates cuentan como partida no ganada.
- **Referencia:** con ~20-25 % de partidas empatadas, un mazo medio gana ~20 %, no 25 %. Por eso las comparaciones usan la media real del meta (`metaWinRate`) y no el 25 % fijo; este queda como dato secundario.
- **Validación:** la página principal comprueba con datos pasados cuántas conclusiones se repiten (por nivel de fiabilidad).
- **Diferencia ajustada y fiabilidad:** la ajustada acerca a 0 las diferencias con poca muestra; la fiabilidad (q de Benjamini-Hochberg) estima la probabilidad de que sea casualidad al mirar cientos de cartas. Ninguna separa «la carta gana» de «los buenos jugadores la llevan»: no se guarda la posición final de cada jugador.
- **El winrate asociado a una carta no es un efecto causal:** refleja sobre todo quién la juega y con qué plan. Con 2.417 cambios reales de lista (mismo jugador y comandante, torneos distintos), añadir cartas con «buen efecto» no mejoró los resultados (pendiente ≈ 0). Por eso las recomendaciones de la lista se basan en uso, no en winrate.
- **Matchups:** la unidad es «un mazo en una mesa» (gana 1 de 4). Comparar «con el rival en la mesa» frente a «sin él» arrastra también quién más se sienta; una diferencia pequeña puede ser composición de mesa y no el rival. Las mesas de un mismo torneo no son independientes, así que z es orientativo.
- Con filtros de tamaño estrechos la muestra baja deprisa: las tablas piden un mínimo de mesas (15 por defecto) con y sin la carta o el rival.

## Endpoints

Todos aceptan además `dec=1` (empates fuera del cálculo). Las respuestas se comprimen con gzip y los cálculos pesados se guardan en memoria hasta la siguiente actualización de datos. `/api/status`, `/api/commanders`, `/api/commander?name=`, `/api/matchups?name=`, `/api/matrix?top=`, `/api/cards-vs?name=&vs=`, `/api/threats?name=` (cartas a tener en cuenta), `/api/combos?name=` (combos y amenazas), `/api/table?me=&r1=&r2=&r3=`, `/api/variants?…&detail=1` (núcleo y huecos), `/api/card?name=`, `/api/cards?q=`, `/api/card-alternatives?name=&commander=`, `/api/novelties` y `/api/meta`, `/api/trend?name=`, `/api/synergy?name=`, `/api/variants?name=&k=` y `POST /api/mylist` (`{commander, list}`). Todos aceptan `minPlayers`, `maxPlayers` y `days` (salvo `trend`, que usa todo el histórico).

## Estructura

- `lib/topdeck.js` — cliente de la API (ventanas de fechas, reintento ante 429).
- `lib/parse.js` — lectura de `decklist` (texto) y `deckObj`.
- `lib/stats.js` — winrate por comandante y diferencia por carta.
- `lib/mock.js` — torneos sintéticos con efectos conocidos, usados en los tests.
- `lib/cache.js` — formato compacto de la caché y comparte las cadenas en memoria.
- `lib/cardindex.js` — índice carta → mazos, sugerencias, informe por carta, novedades y alternativas.
- `lib/meta.js` — meta del momento (presencia, niveles, empates).
- `lib/threats.js` — cartas por función (remates, interacción, tutores, maná, odio) y lo que define a un mazo.
- `lib/combos.js` — combos y amenazas (Commander Spellbook + nuestros mazos).
- `lib/table.js` — preparar mesa (matchups contra rivales concretos y cartas que los distinguen).
- `lib/rating.js` — modelo de Luce (fuerza por comandante); probado, pero no se usa en la web porque no mejora al winrate directo (ver más abajo).
- `server.js` — servidor y rutas de la API.
- `public/index.html` (estructura), `public/app.css` (estilos) y `public/app.js` (lógica). La interfaz va por pestañas: lista (Comandantes · Matriz · Fiabilidad del método) y ficha de comandante (Cartas · Matchups · Evolución · Variantes y paquetes · Mi lista); cada pestaña carga sus datos al abrirla.
- `scripts/make-seed.js` — genera `seed/records.json` (copia de la caché incluida en el repositorio, `npm run seed`).

## Comprobación contra la API real

`TOPDECK_API_KEY=tu_clave npm run check` hace una sola petición (últimos 3 días, `DAYS=14` para más) e imprime solo estructura y recuentos: formato de `deckObj`, porcentaje de listas utilizables, estados y tamaños de mesa, y si los jugadores de las mesas se encuentran en la clasificación. No muestra la clave ni nombres de jugadores. `node scripts/check.js --mock` prueba el propio script con datos sintéticos.
