/* Flecha dinámica: una calcomanía apoyada en el piso, apuntando al destino.
 *
 * Reemplaza a las dos formas fijas (`flecha-adelante`/`flecha-atras`, ver
 * `tour.css`) por una sola que apunta hacia el destino de cada hotspot y que
 * se lee como pintada sobre el suelo, no como un ícono flotando de frente a
 * la cámara. No agrega ningún dato nuevo: usa el `yaw` y el `pitch` que cada
 * hotspot ya trae en `configuracion.json` (`core/tour/pannellum.py`), los
 * mismos que hoy solo sirven para posicionar el ícono.
 *
 * Este módulo calcula los dos ángulos y los publica como custom properties;
 * la transformación 3D que los usa vive en `tour.css`.
 *
 * `hotspot.yaw` es el rumbo absoluto de la foto (relativo al "norte" fijo de
 * esa escena), no la posición en pantalla del ícono: esa posición la calcula
 * Pannellum en cada frame como `hotspot.yaw - visor.getYaw()`, así es como el
 * ícono se desliza por la pantalla al arrastrar la vista. Rotar solo por
 * `hotspot.yaw` hacía que la flecha apuntara "hacia afuera" únicamente en el
 * instante en que la cámara mira exactamente al frente (`getYaw() === 0`) —
 * en cuanto el usuario arrastraba la vista, la posición del ícono cambiaba
 * pero su rotación se quedaba en el ángulo absoluto viejo. Por eso acá se
 * resta lo mismo que resta Pannellum, y por eso hace falta recalcularlo en
 * cada frame (ver `iniciarFlechaDinamica` más abajo) y no solo al cambiar de
 * escena: a diferencia del yaw del hotspot, el yaw de la cámara cambia todo
 * el tiempo que dura un arrastre.
 *
 * ES5 a propósito, mismo motivo que `cursor-piso.js`: viaja dentro del ZIP y
 * lo abre cualquiera, en cualquier navegador, sin ningún paso de
 * compilación.
 *
 * Lo que usa de Pannellum está verificado contra el fuente oficial de la
 * versión 2.5.7 (ver el docstring de `cursor-piso.js` para el detalle de
 * dónde se ubica cada cosa en ese fuente minificado):
 *   - `getConfig().hotSpots` trae, para cada hotspot, su `yaw` (el mismo que
 *     ya usa `hotspotBajoElCursor` de `cursor-piso.js`) y su `div`.
 *   - `getYaw()` devuelve el yaw actual de la cámara, en el mismo marco que
 *     el `yaw` de los hotspots.
 */
(function (global) {
  'use strict';

  /* Cuánto hay que acostar el ícono contra el piso, en grados de `rotateX`.
   *
   * El suelo del destino se ve tanto más rasante cuanto más cerca del
   * horizonte esté el hotspot: a 22° por debajo, ese pedazo de piso se
   * muestra con 22° de inclinación y todo lo apoyado ahí se achata por
   * `sin(22°)`. Un `rotateX(θ)` achata por `cos(θ)`, así que θ = 90° - 22°.
   *
   * No depende de hacia dónde mire la cámara —la distancia y el desnivel al
   * destino son los mismos siempre—, así que este ángulo es constante por
   * hotspot. Lo que sí cambia con la vista es el rumbo, y por eso ese se
   * recalcula al lado en cada frame. */
  /* Techo del escorzo, en grados de `rotateX`.
   *
   * Sin tope, un salto largo deja la flecha invisible: con la cámara a 2 m,
   * un destino a 25 m cae a 4,6° del horizonte, o sea 85,4° de escorzo, y
   * `cos(85,4°)` la achata al 8% de su altura. Es la perspectiva correcta
   * —una calcomanía vista de canto no se ve— y no sirve para nada. A 70° el
   * ícono conserva el 34%, comparable a un salto de 4 m (45%), que es la
   * separación típica. Los saltos cortos quedan por debajo y no lo tocan:
   * 2 m son 45° y 4 m son 63°.
   *
   * Mismo criterio que `FRACCION_RADIO_MAXIMO` en `cursor-piso.js`: se
   * prefiere un techo que deje de exagerar antes que ocultar el ícono. */
  var ESCORZO_MAXIMO = 70;

  function escorzoDe(pitchGrados) {
    return Math.min(90 - Math.abs(pitchGrados), ESCORZO_MAXIMO);
  }

  /* Lleva un ángulo a (-180, 180].
   *
   * `hotspot.yaw - getYaw()` puede dar cualquier cosa entre -540 y 540, y
   * -311° dibuja exactamente lo mismo que 49°. La diferencia aparece al
   * cruzar el borde: sin normalizar, un arrastre que lleve el rumbo de 179° a
   * -181° manda la flecha a pegar una vuelta entera en vez de seguir de
   * largo. Es la misma cuenta que `normalizar_a_mas_menos_180` en
   * `core/tour/geometry.py`, del otro lado del mismo dato. */
  function normalizar(grados) {
    return ((grados + 180) % 360 + 360) % 360 - 180;
  }

  // Cada div guarda el último valor que se le escribió: tocar una custom
  // property obliga al navegador a recalcular estilos aunque el valor sea el
  // mismo, y con la vista quieta no hay nada que recalcular. Guardarlo en el
  // div, y no en una tabla aparte, cubre sin más los divs nuevos que Pannellum
  // crea al cargar cada escena.
  function fijar(div, propiedad, valor) {
    if (div['_' + propiedad] === valor) { return; }
    div['_' + propiedad] = valor;
    div.style.setProperty(propiedad, valor);
  }

  function fijarRotaciones(visor) {
    var config = visor.getConfig();
    var hotspots = (config && config.hotSpots) || [];
    var yawCamara = visor.getYaw();
    for (var i = 0; i < hotspots.length; i++) {
      var hotspot = hotspots[i];
      if (!hotspot.div || typeof hotspot.yaw !== 'number') {
        continue;
      }
      fijar(hotspot.div, '--flecha-rumbo', normalizar(hotspot.yaw - yawCamara) + 'deg');
      if (typeof hotspot.pitch === 'number') {
        fijar(hotspot.div, '--flecha-escorzo', escorzoDe(hotspot.pitch) + 'deg');
      }
    }
  }

  function iniciarFlechaDinamica(visor, contenedor, vista) {
    contenedor.classList.add('con-flecha-dinamica');
    // Ni 'load' ni 'scenechange' alcanzan solos: cubren el momento en que
    // aparecen los hotspots de una escena, pero no el arrastre de la vista
    // dentro de esa misma escena, que es continuo y no dispara ningún
    // evento de Pannellum. El bucle compartido de `vista.js` cubre las dos
    // cosas —arrastre con mouse o touch, teclado, carga de escena— y se
    // duerme con la vista quieta. El visor nunca se destruye durante la vida
    // de la página, así que no hace falta darse de baja.
    vista.alCuadro(function () { fijarRotaciones(visor); });
    return null;
  }

  global.iniciarFlechaDinamica = iniciarFlechaDinamica;
})(window);
