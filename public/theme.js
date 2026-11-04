// Aplica el tema elegido antes de pintar la página (evita el parpadeo). Script clásico y externo por la CSP.
(function () { try { var t = localStorage.getItem('cedh.theme'); if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t; } catch (e) { /* sin almacenamiento */ } })();
