/* La paleta del tour: un color semilla y los tonos que se derivan de él.
 *
 * Existe porque el mismo "color de acento" aparecía escrito a mano en cuatro
 * lugares y con cuatro valores distintos —el azul de los iconos activos, otro
 * azul para la trayectoria del minimapa, un celeste para el hover de la rosa
 * y un naranja para el punto—, así que cambiarlo significaba encontrarlos
 * todos y acertarle a mano a cada tonalidad. Ahora se elige uno y el resto
 * sale de acá.
 *
 * Los tonos NO son el mismo color repetido. Dos elementos que se tocan y
 * comparten color exacto se leen como uno solo: el punto del minimapa se
 * apoya justo encima de la línea del recorrido, y el hover de la rosa tiene
 * que leerse como "esta flecha está resaltada" sobre un blanco. Por eso cada
 * uno recibe la luminosidad que su trabajo necesita, conservando el tono.
 *
 * Lo que NO se ajusta solo es la semilla misma donde se usa tal cual (los
 * iconos, las flechas). Corregirle el contraste sería entregarle al usuario
 * un color distinto del que eligió en el selector, y el selector es la
 * promesa de que va a ver exactamente ese.
 *
 * ES5 a propósito, como el resto de los módulos del tour: viaja dentro del
 * ZIP y lo abre cualquiera, sin ningún paso de compilación.
 */
(function (global) {
  'use strict';

  /* El azul que el tour usó siempre. Es el valor de reserva y el default del
   * selector: un tour generado antes de que la semilla existiera, o con un
   * valor corrupto en `configuracion.json`, se sigue viendo como se veía. */
  var SEMILLA_POR_DEFECTO = '#1e90ff';

  /* Luminosidad del tono tenue, en porcentaje. Sale de medir el celeste que
   * el hover de la rosa tenía escrito a mano (#cce9ff, L=90%) contra el azul
   * de los iconos (#1e90ff, L=56%): es el mismo tono, muy aclarado. */
  var L_TENUE = 90;

  /* Cuánto se oscurece el punto del minimapa respecto de la línea del
   * recorrido sobre la que se apoya. Con menos, el aro blanco de 2px queda
   * como única separación y el punto deja de leerse como un punto. */
  var DELTA_PUNTO = 16;
  var L_MINIMA_PUNTO = 12;

  /* Opacidades del cono de la vista. Más altas que las que tenía el cono azul
   * porque el mapa base de OpenStreetMap es beige: un tono cálido se le
   * confunde encima, y uno frío se recorta solo. Medido sobre el tour real. */
  var CONO_RELLENO = 0.32;
  var CONO_BORDE = 0.85;

  function normalizar(valor) {
    if (typeof valor !== 'string') { return null; }
    var texto = valor.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(texto)) { return texto.toLowerCase(); }
    // Tres dígitos es una forma válida de escribir un color en CSS y el
    // usuario puede haberla tipeado; se expande en vez de rechazarse.
    if (/^#[0-9a-fA-F]{3}$/.test(texto)) {
      return ('#' + texto[1] + texto[1] + texto[2] + texto[2] +
        texto[3] + texto[3]).toLowerCase();
    }
    return null;
  }

  function aHsl(hex) {
    var r = parseInt(hex.slice(1, 3), 16) / 255;
    var g = parseInt(hex.slice(3, 5), 16) / 255;
    var b = parseInt(hex.slice(5, 7), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2;
    if (max === min) { return {h: 0, s: 0, l: l * 100}; }
    var d = max - min;
    var s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    var h;
    if (max === r) { h = (g - b) / d + (g < b ? 6 : 0); }
    else if (max === g) { h = (b - r) / d + 2; }
    else { h = (r - g) / d + 4; }
    return {h: h * 60, s: s * 100, l: l * 100};
  }

  function componente(p, q, t) {
    if (t < 0) { t += 1; }
    if (t > 1) { t -= 1; }
    if (t < 1 / 6) { return p + (q - p) * 6 * t; }
    if (t < 1 / 2) { return q; }
    if (t < 2 / 3) { return p + (q - p) * (2 / 3 - t) * 6; }
    return p;
  }

  function aHex(hsl) {
    var h = ((hsl.h % 360) + 360) % 360 / 360;
    var s = Math.max(0, Math.min(100, hsl.s)) / 100;
    var l = Math.max(0, Math.min(100, hsl.l)) / 100;
    var canales;
    if (s === 0) { canales = [l, l, l]; }
    else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      canales = [componente(p, q, h + 1 / 3), componente(p, q, h),
        componente(p, q, h - 1 / 3)];
    }
    return '#' + canales.map(function (canal) {
      var texto = Math.round(canal * 255).toString(16);
      return texto.length === 1 ? '0' + texto : texto;
    }).join('');
  }

  /* Los tonos que salen de una semilla.
   *
   * `acento` es la semilla tal cual: es lo que el usuario eligió y lo que ve
   * en el selector. Los otros dos la corren de luminosidad sin tocarle el
   * tono, así que siguen leyéndose como el mismo color.
   */
  function derivar(semilla) {
    var base = normalizar(semilla) || SEMILLA_POR_DEFECTO;
    var hsl = aHsl(base);
    return {
      acento: base,
      /* Un lavado del acento, para pintar un área grande sin taparla: el
       * hover de las flechas de la rosa. Conserva la saturación, así que un
       * gris de semilla sigue dando un gris. */
      tenue: aHex({h: hsl.h, s: hsl.s, l: L_TENUE}),
      /* La línea del recorrido en el minimapa se queda con el acento: es el
       * elemento dominante y el que tiene que coincidir con los iconos. */
      trazo: base,
      /* El punto se apoya encima de esa línea, así que baja un escalón de
       * luminosidad para no fundirse con ella. */
      punto: aHex({
        h: hsl.h, s: hsl.s, l: Math.max(L_MINIMA_PUNTO, hsl.l - DELTA_PUNTO)
      }),
      cono: base,
      conoRelleno: CONO_RELLENO,
      conoBorde: CONO_BORDE
    };
  }

  /* Publica la paleta como variables CSS y la devuelve.
   *
   * Las variables van en el elemento raíz y no en el contenedor del visor
   * porque hay elementos del tour que Pannellum cuelga fuera de él, y una
   * variable definida en un ancestro que no los contiene no los alcanza.
   */
  function aplicarPaleta(documento, semilla) {
    var paleta = derivar(semilla);
    var raiz = documento.documentElement;
    if (raiz && raiz.style && raiz.style.setProperty) {
      raiz.style.setProperty('--acento', paleta.acento);
      raiz.style.setProperty('--acento-tenue', paleta.tenue);
    }
    return paleta;
  }

  global.aplicarPaleta = aplicarPaleta;
  global.aplicarPaleta.derivar = derivar;
  global.aplicarPaleta.SEMILLA_POR_DEFECTO = SEMILLA_POR_DEFECTO;
})(typeof window === 'undefined' ? this : window);
