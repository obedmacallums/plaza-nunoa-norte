/* El zoom de la vista cuando la pantalla es vertical.
 *
 * Pannellum fija el campo de visión HORIZONTAL (`hfov`, 100° por defecto). En
 * una pantalla apaisada eso da un alto de ~65°; en un celular en vertical, el
 * mismo ancho de 100° sobre una pantalla alta abre el alto a ~135°, y la
 * perspectiva se estira en los bordes de arriba y de abajo: un ojo de pez.
 *
 * Acá se mantiene el alto de campo en vez del ancho: en vertical el `hfov` baja
 * hasta el que da `VFOV_EN_VERTICAL` de alto con la proporción real de la
 * pantalla, y al volver a apaisado se restaura el de la configuración. El
 * visitante conserva el pellizco para acercar o alejar.
 *
 * Pannellum vuelve a leer `hfov` y `minHfov` de la escena cada vez que carga
 * una, así que se escriben ahí, en la configuración viva de cada escena (la
 * que devuelve `getConfig().scenes`), y no solo en la vista actual: si no, la
 * escena siguiente arrancaría con el ancho original, y con él, el ojo de pez.
 *
 * ES5 a propósito, como el resto de los módulos del tour.
 */
(function (global) {
  'use strict';

  // El alto de campo vertical, en grados, al que apunta la vista en vertical.
  // Entre los ~65° de una pantalla apaisada y los ~135° que daba el ancho de
  // siempre: lo bastante abierto para ver el entorno y sin el estiramiento
  // de los bordes.
  var VFOV_EN_VERTICAL = 80;
  // Lo que Pannellum usa cuando la configuración no dice nada.
  var HFOV_POR_DEFECTO = 100;
  var HFOV_MINIMO_POR_DEFECTO = 50;
  // Tope para el que se calcula el mínimo: mucho más cerrado no se ve nada.
  var HFOV_MINIMO_EN_VERTICAL = 25;

  function aGrados(radianes) { return radianes * 180 / Math.PI; }

  /* El `hfov` que da `vfov` de alto con esta proporción ancho/alto. */
  function hfovParaAlto(vfov, proporcion) {
    return aGrados(2 * Math.atan(Math.tan(vfov * Math.PI / 360) * proporcion));
  }

  function iniciarZoomVertical(visor, contenedor) {
    var escenas = visor.getConfig().scenes || {};
    var valoresPorDefecto = visor.getConfig().default || {};
    var originales = {};
    Object.keys(escenas).forEach(function (id) {
      originales[id] = { hfov: escenas[id].hfov, minHfov: escenas[id].minHfov };
    });
    var enVertical = null;

    function hfovBase(id) {
      var propio = originales[id] && originales[id].hfov;
      if (typeof propio === 'number') { return propio; }
      return typeof valoresPorDefecto.hfov === 'number' ? valoresPorDefecto.hfov : HFOV_POR_DEFECTO;
    }

    function minimoBase(id) {
      var propio = originales[id] && originales[id].minHfov;
      if (typeof propio === 'number') { return propio; }
      return typeof valoresPorDefecto.minHfov === 'number'
        ? valoresPorDefecto.minHfov : HFOV_MINIMO_POR_DEFECTO;
    }

    function escribir(objeto, clave, valor) {
      if (valor === undefined) { delete objeto[clave]; } else { objeto[clave] = valor; }
    }

    function ajustar() {
      var ancho = contenedor.clientWidth;
      var alto = contenedor.clientHeight;
      if (!ancho || !alto) { return; }
      var vertical = ancho < alto;
      var calculado = hfovParaAlto(VFOV_EN_VERTICAL, ancho / alto);
      Object.keys(escenas).forEach(function (id) {
        if (vertical) {
          escenas[id].hfov = Math.min(hfovBase(id), calculado);
          escenas[id].minHfov = Math.min(minimoBase(id), HFOV_MINIMO_EN_VERTICAL);
        } else {
          escribir(escenas[id], 'hfov', originales[id].hfov);
          escribir(escenas[id], 'minHfov', originales[id].minHfov);
        }
      });
      var actual = visor.getScene();
      var limites = visor.getHfovBounds();
      visor.setHfovBounds([
        vertical ? Math.min(minimoBase(actual), HFOV_MINIMO_EN_VERTICAL) : minimoBase(actual),
        limites[1]
      ]);
      // La vista que ya está abierta solo cambia al girar el aparato: un
      // cambio de tamaño dentro de la misma orientación (la barra del
      // navegador que se esconde) no puede deshacer el zoom del visitante.
      if (vertical !== enVertical) {
        enVertical = vertical;
        visor.setHfov(vertical ? Math.min(hfovBase(actual), calculado) : hfovBase(actual), 0);
      }
    }

    // La primera escena todavía no cargó cuando se inicia el módulo: ya con
    // ella cargada se acomoda la vista que se está viendo.
    ajustar();
    global.addEventListener('resize', ajustar);
    return function detener() {
      global.removeEventListener('resize', ajustar);
    };
  }

  global.iniciarZoomVertical = iniciarZoomVertical;
})(window);
