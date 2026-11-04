// Punto de entrada: carga los módulos de js/ y arranca la página.
import { $ } from './js/core.js';
import { watchTables } from './js/mobile.js';
import { watchCommanders } from './js/visual.js';
import { readHash } from './js/nav.js';
import { bindFilters, bindGlobalSearch, updateFilterSummary, boot } from './js/main.js';
import { adoptShareUrl, bindShare, bindTheme, registerWorker } from './js/shell.js';
import './js/cardpop.js';    // imagen de la carta al pasar el ratón
import './js/sorttable.js';  // tablas ordenables pulsando la cabecera

watchTables($('#app'));
watchCommanders($('#app'));
adoptShareUrl();   // /?c=NOMBRE (enlaces compartidos) -> dirección habitual con #
readHash();
bindTheme();
bindShare();
registerWorker();
bindFilters();
bindGlobalSearch();
// los filtros empiezan plegados (el resumen de lo elegido siempre se ve)
updateFilterSummary();
boot().catch(e => { $('#status').textContent = 'Error: ' + e.message; });
