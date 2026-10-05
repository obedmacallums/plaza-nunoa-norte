/* Un solo bucle de cuadros para todo lo que sigue a la vista, y que se duerme.
 *
 * El cursor de piso, la flecha dinámica, la rosa de direcciones y el
 * minimapa necesitan enterarse de cada giro, cabeceo o zoom de la cámara, y
 * Pannellum no emite ningún evento por eso. Cada uno corría su propio
 * `requestAnimationFrame` para siempre: con la vista quieta, la página seguía
 * despierta a 60 cuadros por segundo repitiendo cuatro veces el mismo sondeo.
 *
 * Acá hay un bucle solo. Mientras la vista cambia avisa a todos en cada
 * cuadro; cuando lleva `CUADROS_QUIETOS` sin cambiar se detiene, y lo vuelve
 * a arrancar cualquier cosa que pueda mover la cámara: una entrada del
 * usuario, un cambio de tamaño o una escena que carga. La inercia de
 * Pannellum después de soltar un arrastre no necesita nada aparte: mientras
 * dura, la vista sigue cambiando y el bucle sigue despierto.
 */
(function (global) {
  'use strict';

  // Medio segundo a 60 fps. Da margen a los primeros cuadros después de una
  // entrada, en los que Pannellum todavía no movió la cámara.
  var CUADROS_QUIETOS = 30;

  // Todo lo que puede mover la cámara pasa por alguno de estos. Se escuchan
  // en fase de captura para que un control que frena la propagación (la
  // rosa, el minimapa) igual despierte el bucle.
  var ENTRADAS_DEL_VISOR = ['pointerdown', 'pointermove', 'mousedown', 'mousemove',
    'wheel', 'touchstart', 'touchmove'];

  function seguirLaVista(visor, contenedor) {
    var oyentes = [];
    var anterior = null;
    var quietos = 0;
    var cuadro = null;

    function estado() {
      return [visor.getScene(), visor.getYaw(), visor.getPitch(), visor.getHfov(),
        contenedor.clientWidth, contenedor.clientHeight].join('/');
    }

    function alCuadro() {
      cuadro = null;
      var actual = estado();
      if (actual !== anterior) {
        anterior = actual;
        quietos = 0;
      } else {
        quietos++;
      }
      // Una copia: un oyente puede darse de baja mientras se lo avisa.
      var avisar = oyentes.slice();
      for (var i = 0; i < avisar.length; i++) {
        avisar[i]();
      }
      if (quietos < CUADROS_QUIETOS) {
        cuadro = global.requestAnimationFrame(alCuadro);
      }
    }

    function despertar() {
      quietos = 0;
      if (cuadro === null) {
        cuadro = global.requestAnimationFrame(alCuadro);
      }
    }

    var opciones = { capture: true, passive: true };
    ENTRADAS_DEL_VISOR.forEach(function (tipo) {
      contenedor.addEventListener(tipo, despertar, opciones);
    });
    // El teclado de Pannellum actúa con el foco en cualquier parte de la
    // página, y un cambio de tamaño o de pantalla completa cambia la
    // proyección sin mover la cámara.
    global.document.addEventListener('keydown', despertar, opciones);
    global.addEventListener('resize', despertar);
    visor.on('scenechange', despertar);
    visor.on('load', despertar);

    despertar();

    return {
      // `fn` se llama en cada cuadro en que el bucle está despierto, cambie o
      // no la vista: cada módulo sabe mejor que nadie qué le importa de ella
      // y compara eso por su cuenta. Devuelve la baja.
      alCuadro: function (fn) {
        oyentes.push(fn);
        despertar();
        return function () {
          var indice = oyentes.indexOf(fn);
          if (indice !== -1) { oyentes.splice(indice, 1); }
        };
      },
      // Para quien cambió algo que la vista no refleja —mostrar un panel que
      // estaba oculto— y necesita un cuadro más aunque la cámara esté quieta.
      despertar: despertar
    };
  }

  global.seguirLaVista = seguirLaVista;
})(window);
