/* Etiquetas al pasar el mouse con el estilo del tour, en lugar del tooltip
 * nativo.
 *
 * El `title` de un botón lo dibuja el sistema, con su fondo claro, y no hay
 * CSS que lo alcance. Este módulo le saca el `title` a todo lo que hay dentro
 * del tour —también al que un módulo reescribe al cambiar de estado, como
 * «Mostrar minimapa» / «Ocultar minimapa»— y muestra el texto en una sola
 * etiqueta propia, con el gris translúcido de la ficha de coordenadas.
 *
 * Los módulos siguen escribiendo `title` como siempre: así sus pruebas no
 * dependen de este, y sin este módulo el tour vuelve al tooltip nativo. */
(function (global) {
  'use strict';

  var SEPARACION_PX = 8;
  var BORDE_PX = 4;

  function iniciarEtiquetas(contenedor) {
    var etiqueta = document.createElement('div');
    etiqueta.className = 'etiqueta-tour';
    etiqueta.setAttribute('aria-hidden', 'true');
    etiqueta.hidden = true;
    contenedor.appendChild(etiqueta);
    var actual = null;

    function ocultar() {
      actual = null;
      etiqueta.hidden = true;
    }

    // Al costado del elemento, hacia el centro del tour: los botones de la
    // derecha la muestran a su izquierda y los de la izquierda, a su derecha.
    function mostrar(elemento) {
      var texto = elemento.getAttribute('data-etiqueta');
      if (!texto) { ocultar(); return; }
      actual = elemento;
      etiqueta.textContent = texto;
      etiqueta.hidden = false;
      var caja = contenedor.getBoundingClientRect();
      var r = elemento.getBoundingClientRect();
      var ancho = etiqueta.offsetWidth;
      var alto = etiqueta.offsetHeight;
      var x = r.left + r.width / 2 > caja.left + caja.width / 2
        ? r.left - caja.left - ancho - SEPARACION_PX
        : r.right - caja.left + SEPARACION_PX;
      var y = r.top - caja.top + (r.height - alto) / 2;
      x = Math.max(BORDE_PX, Math.min(x, caja.width - ancho - BORDE_PX));
      y = Math.max(BORDE_PX, Math.min(y, caja.height - alto - BORDE_PX));
      etiqueta.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
    }

    function adoptar(elemento) {
      var titulo = elemento.getAttribute('title');
      if (titulo === null) { return; }
      elemento.removeAttribute('title');
      if (!titulo) { return; }
      elemento.setAttribute('data-etiqueta', titulo);
      // El `title` también nombraba al control: sin él, que lo nombre esto.
      if (!elemento.hasAttribute('aria-label')) { elemento.setAttribute('aria-label', titulo); }
      if (elemento === actual) { mostrar(elemento); }
    }

    function adoptarTodo(raiz) {
      if (raiz.nodeType !== 1) { return; }
      adoptar(raiz);
      Array.prototype.forEach.call(raiz.querySelectorAll('[title]'), adoptar);
    }

    adoptarTodo(contenedor);
    new MutationObserver(function (cambios) {
      cambios.forEach(function (cambio) {
        if (cambio.type === 'attributes') {
          adoptar(cambio.target);
        } else {
          Array.prototype.forEach.call(cambio.addedNodes, adoptarTodo);
        }
      });
    }).observe(contenedor, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['title']
    });

    // Solo con mouse: en táctil no hay hover, y una etiqueta que aparece al
    // tocar y se queda tapa lo que se acaba de abrir.
    contenedor.addEventListener('pointerover', function (evento) {
      if (evento.pointerType && evento.pointerType !== 'mouse') { return; }
      var elemento = evento.target.closest && evento.target.closest('[data-etiqueta]');
      if (elemento && contenedor.contains(elemento)) { mostrar(elemento); } else { ocultar(); }
    });
    contenedor.addEventListener('pointerout', function (evento) {
      if (actual && !(evento.relatedTarget && actual.contains(evento.relatedTarget))) { ocultar(); }
    });
    // Al hacer clic el control cambia de estado (y de texto): la etiqueta se
    // va y vuelve con el texto nuevo al pasar otra vez.
    contenedor.addEventListener('pointerdown', ocultar, true);
  }

  global.iniciarEtiquetas = iniciarEtiquetas;
})(window);
