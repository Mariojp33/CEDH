export const guideHtml = () => `<div class="panel guide">
  <h2>Cómo leer esta web</h2>
  <h3>De dónde salen los datos</h3>
  <p>Torneos del formato EDH de <a href="https://topdeck.gg" target="_blank" rel="noopener">TopDeck.gg</a> de los últimos seis meses. Solo se usan los que parecen cEDH: los casuales, de precons, de presupuesto o brawl se descartan por el contenido de sus mazos, no por el nombre. Los datos se actualizan solos.</p>
  <h3>Winrate, «pts» y la media del meta</h3>
  <p>El winrate es victorias entre partidas jugadas. Se compara con la <b>media del meta</b> del periodo elegido, no con el 25 % teórico de una mesa de 4, porque los empates (en torno a una de cada cinco partidas) hacen que la media real quede por debajo. Una diferencia de «+3 pts» son tres puntos porcentuales: un 28 % frente a una media del 25 %.</p>
  <h3>Empates</h3>
  <p>Por defecto un empate cuenta como partida no ganada (winrate = victorias ÷ todas las partidas), por eso la media del meta queda por debajo del 25 %. Puedes cambiarlo en los filtros para que los empates salgan del cálculo (winrate = victorias ÷ victorias + derrotas, con la referencia en torno al 25 %). La tasa de empates se muestra aparte: es una característica estable de cada comandante.</p>
  <h3>Intervalos y colores</h3>
  <p>Cada winrate tiene un intervalo de confianza del 95 %. Solo se pinta de verde o rojo cuando ese intervalo queda entero por encima o por debajo de la media; en <b>gris</b> no se distingue de ella, normalmente por falta de partidas. Los niveles S-D de «Meta» salen de ese mismo intervalo, así que un mazo con pocas partidas no sube por suerte.</p>
  <h3>Lo que esta web no prueba</h3>
  <p>El winrate asociado a una carta o a un combo es una <b>correlación, no una mejora demostrada</b>: refleja sobre todo quién juega la carta y con qué plan. Lo comprobamos con cambios reales de lista de los mismos jugadores y no se confirmó, por eso las recomendaciones de «Revisar mi lista» se basan en lo que juegan listas parecidas y no en el winrate de cada carta. En «Fiabilidad del método» ves qué parte de las conclusiones se mantiene en datos nuevos.</p>
  <h3>Combos y cartas por función</h3>
  <p>Los combos vienen de <a href="https://commanderspellbook.com" target="_blank" rel="noopener">Commander Spellbook</a> y se cruzan con los mazos para ver cuáles se juegan de verdad. Recogen combos infinitos y de victoria, no remates por valor ni victorias sin combo: «sin combo detectado» no significa inofensivo. Las listas de remates, interacción, tutores, maná rápido y odio son de criterio y se editan a mano.</p>
  <h3>Matchups</h3>
  <p>Son históricos, no predicciones. Cambiar de rival cambia también a quién más te sientas, y las mesas de un mismo torneo no son independientes. En cEDH suelen ser casi planos.</p>
</div>`;
