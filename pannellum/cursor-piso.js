/* Cursor de piso: un círculo acostado en el suelo que sigue al mouse.
 *
 * Reemplaza a las flechas en escritorio (ver `tour.css`). El círculo se
 * agranda al acercarse, se achata cerca del horizonte y se tiñe de azul al
 * entrar en la zona de un destino, donde el clic navega.
 *
 * ES5 a propósito: este archivo viaja dentro del ZIP y lo abre cualquiera, en
 * cualquier navegador, sin ningún paso de compilación.
 *
 * Las tres cosas que usa de Pannellum están verificadas contra el fuente
 * oficial de la versión 2.5.7, no recordadas. Se citan por nombre de función,
 * no por línea: el `pannellum.js` vendorizado junto a este archivo está
 * minificado, con los identificadores mangleados y el texto envuelto en
 * líneas de 500 a 918 caracteres, así que un número de línea del fuente
 * original no serviría para encontrar nada acá al lado.
 *   - `mouseEventToCoords` devuelve [cabeceo, yaw] en grados, cabeceo
 *     positivo hacia arriba y yaw ya absoluto en el marco de la escena — el
 *     mismo marco que el `yaw` de los hotspots, así que la comparación es
 *     directa.
 *   - `getConfig` devuelve el config vivo de la escena.
 *   - cada hotspot guarda su `div` (el código que arma el hotspot está
 *     mangleado a un nombre corto, pero se ubica buscando el literal
 *     `pnlm-hotspot-base`, que aparece junto a `f.onclick=f.ontouchend=` y
 *     `a.div=f`) y ese div tiene registrado el `click` que hace el salto.
 */
(function (global) {
  'use strict';

  /* Radio del círculo sobre el suelo. 80 cm de diámetro: del tamaño de una
   * huella de paso, visible a 4 m y todavía reconocible a 20 m. */
  var RADIO_M = 0.4;

  /* Radio de la zona sensible, como fracción de la distancia al destino. Con
   * fotos cada 4 m son 1,6 m; con fotos cada 2 m se achica sola a 0,8 m. */
  var FRACCION_TOLERANCIA = 0.4;

  /* Más allá de esto el círculo sería un punto de un píxel que solo ensucia.
   *
   * Es solo el valor de reserva: `bundle.py` calcula el tope real a partir
   * del salto más largo del tour y lo manda en `opciones.distanciaMaximaM`.
   * Un tope fijo dejaría, con separaciones grandes en el panel de
   * exportación, la zona sensible más allá de donde el círculo llega a
   * dibujarse. */
  var DISTANCIA_MAXIMA_M = 25;
  var RADIO_MINIMO_PX = 3;

  /* Techo del radio, como fracción del ancho del lienzo.
   *
   * Cerca del nadir la distancia al suelo tiende a cero y el radio crece sin
   * límite: mirándose los pies, a -80° de cabeceo con la cámara a 2 m, el
   * círculo ya sería más ancho que la pantalla. La perspectiva es correcta
   * pero inservible. El techo complementa la zona excluida junto a la cámara
   * y evita tamaños excesivos con campos de visión muy estrechos. */
  var FRACCION_RADIO_MAXIMO = 0.3;

  /* Todo arrastre termina en un `click`. Sin este umbral, soltar el botón
   * dentro de una zona azul después de girar la vista navegaría sin que nadie
   * lo pidiera. */
  var UMBRAL_ARRASTRE_PX = 5;

  /* La misma condición que consulta `tour.css`, pero la relación ya no es
   * simétrica: el CSS oculta las flechas solo dentro de
   * `.con-cursor-de-piso`, una clase que este módulo agrega al contenedor
   * recién si `iniciarCursorDePiso` arranca de verdad. Así, si hay hover
   * pero por lo que sea el módulo no llega a inicializarse (el script no
   * cargó, el visor tiró una excepción), las flechas quedan visibles en vez
   * de desaparecer sin que nada las reemplace.
   *
   * Pregunta por hover y NO por `(pointer: fine)`, por dos razones. La de
   * fondo: lo que el círculo necesita es que exista hover —sigue al mouse
   * por el piso antes de que nadie haga clic—, no que el puntero sea fino.
   * La concreta: `(pointer: fine)` dejaba afuera a la vista previa dentro de
   * la aplicación. QtWebEngine responde `pointer: none` —medido en una
   * ventana real: ni `fine` ni `coarse`, `any-pointer` tampoco, y sin
   * embargo `hover: hover` en true— porque Chromium deduce el tipo de
   * puntero enumerando dispositivos de entrada de la plataforma y Qt no le
   * alimenta esa información. El mismo tour, servido por el mismo servidor,
   * mostraba flechas en la pestaña de la aplicación y cursor de piso en
   * Chrome. */
  var HAY_HOVER = '(hover: hover)';

  /* Encima de estos elementos no hay piso que señalar, sino un control que el
   * visitante está usando: el círculo se esconde y el clic no navega.
   *
   * Una sola lista para las dos cosas. Mientras estuvieron escritas por
   * separado divergieron —el minimapa quedó afuera de ambas, pero nada
   * impedía que entrara en una sola—, y esa diferencia es la peor posible:
   * una zona donde el círculo no se dibuja y el clic igual salta de escena,
   * o sea un salto que el visitante no ve venir.
   *
   * El minimapa se cierra con `visibility: hidden` y `pointer-events: none`
   * (`tour.css`), así que mientras está oculto no es blanco de ningún evento
   * y esta regla no lo alcanza. */
  var SELECTOR_CONTROLES =
    'button, a, input, select, .pnlm-controls, .control-gnss, .minimapa';

  var GRADOS_A_RADIANES = Math.PI / 180;

  /* A qué distancia está el punto del suelo que se ve con ese cabeceo.
   *
   * Supone un piso plano a `alturaM` por debajo del observador, sin ningún
   * desnivel. Con la cámara a 2 m y un piso al mismo nivel: -45° son 2 m,
   * -26,6° son 4 m y -11,3° son 10 m.
   *
   * Esto NO es la misma cuenta que el cabeceo de las flechas, aunque se
   * parezcan: `cabeceo_grados` (`core/tour/geometry.py`) resta `desnivel_m`,
   * la diferencia de altura real con el destino, algo que esta función no
   * tiene forma de conocer para un punto arbitrario del suelo. Son la misma
   * fórmula solo cuando `desnivel_m` es 0. En una pendiente, la flecha
   * apunta al destino real y el círculo asume terreno plano: en un tour a
   * nivel no se nota, pero en una pendiente marcada la zona azul y la flecha
   * pueden divergir.
   *
   * Devuelve Infinity en el horizonte o por encima, donde no hay suelo que
   * mirar. */
  function distanciaEnElSuelo(cabeceoGrados, alturaM) {
    if (cabeceoGrados >= 0) {
      return Infinity;
    }
    return alturaM / Math.tan(-cabeceoGrados * GRADOS_A_RADIANES);
  }

  /* Semiejes en píxeles de un círculo de `radioM` apoyado en el suelo.
   *
   * `focalPx` son los píxeles por radián en el centro de la vista. El semieje
   * menor sale del ángulo de depresión: un círculo visto de canto se aplasta
   * por `sin(|cabeceo|)`, que vale 1 mirando al nadir y tiende a 0 en el
   * horizonte. */
  function tamanoDeLaElipse(distanciaM, cabeceoGrados, radioM, focalPx) {
    var rx = focalPx * radioM / distanciaM;
    return {
      rx: rx,
      ry: rx * Math.abs(Math.sin(cabeceoGrados * GRADOS_A_RADIANES))
    };
  }

  /* Un punto del suelo, de polares (distancia, yaw) a cartesianas.
   *
   * El marco es el del visor y da igual dónde esté el norte: el cursor y los
   * hotspots se expresan los dos en el mismo yaw, así que la comparación no
   * necesita ninguna conversión intermedia donde perder un signo. */
  function aPlano(distanciaM, yawGrados) {
    var radianes = yawGrados * GRADOS_A_RADIANES;
    return {
      x: distanciaM * Math.sin(radianes),
      y: distanciaM * Math.cos(radianes)
    };
  }

  /* El hotspot en cuya zona cae el cursor, o null.
   *
   * Un hotspot sin `distanciaM` no participa: es un tour viejo abierto con un
   * `cursor-piso.js` nuevo, y el resto tiene que seguir funcionando. */
  function hotspotBajoElCursor(distanciaM, yawGrados, hotspots, fraccion) {
    var cursor = aPlano(distanciaM, yawGrados);
    for (var i = 0; i < hotspots.length; i++) {
      var hotspot = hotspots[i];
      if (typeof hotspot.distanciaM !== 'number') {
        continue;
      }
      var destino = aPlano(hotspot.distanciaM, hotspot.yaw);
      var dx = cursor.x - destino.x;
      var dy = cursor.y - destino.y;
      if (Math.sqrt(dx * dx + dy * dy) <= fraccion * hotspot.distanciaM) {
        return hotspot;
      }
    }
    return null;
  }

  /* La tolerancia crece hasta cubrir el suelo navegable. Normalizar por la
   * distancia mayor evita que los puntos lejanos queden sin destino a alta
   * sensibilidad. En solapamientos gana la distancia real más corta. */
  function seleccionarHotspot(distanciaM, yawGrados, hotspots, sensibilidad, minimaM) {
    if (!isFinite(distanciaM) || distanciaM < minimaM) { return null; }
    var cursor = aPlano(distanciaM, yawGrados);
    var tolerancia = 0.05 + 1.95 * Math.pow(sensibilidad / 100, 2);
    var elegido = null;
    var menor = Infinity;
    hotspots.forEach(function (hotspot) {
      if (!(hotspot.distanciaM > 0) || !isFinite(hotspot.distanciaM)) { return; }
      var destino = aPlano(hotspot.distanciaM, hotspot.yaw);
      var distancia = Math.sqrt(Math.pow(cursor.x - destino.x, 2) + Math.pow(cursor.y - destino.y, 2));
      if (distancia <= tolerancia * Math.max(distanciaM, hotspot.distanciaM) && distancia < menor) {
        menor = distancia;
        elegido = hotspot;
      }
    });
    return elegido;
  }

  function iniciarCursorDePiso(visor, contenedor, opciones, vista) {
    if (!global.matchMedia || !global.matchMedia(HAY_HOVER).matches) {
      return null;
    }

    if (typeof opciones.alturaCamaraM !== 'number') {
      throw new Error(
        'iniciarCursorDePiso: falta opciones.alturaCamaraM. Sin ella la ' +
          'distancia da NaN y el círculo nunca se muestra, en silencio.'
      );
    }
    var alturaM = opciones.alturaCamaraM;
    var radioM = opciones.radioM || RADIO_M;
    // El radio compartido escala el cursor completo y ambos contornos de los aros.
    var escala = typeof opciones.tamano === 'number' && isFinite(opciones.tamano) ?
      Math.max(25, Math.min(200, opciones.tamano)) / 100 : 0.64;
    radioM *= escala;
    var fraccion = opciones.fraccionTolerancia || FRACCION_TOLERANCIA;
    var distanciaMaxima = opciones.distanciaMaximaM || DISTANCIA_MAXIMA_M;
    var sensibilidad = typeof opciones.sensibilidad === 'number' ? opciones.sensibilidad : 56;
    var distanciaMinima = alturaM * 0.65;
    var conAros = opciones.modoHotspot === 'circular';

    function color(valor, reserva) {
      return /^#[0-9a-f]{6}$/i.test(valor) ? valor : reserva;
    }
    function opacidad(valor, reserva) {
      return typeof valor === 'number' && isFinite(valor) ? Math.max(0, Math.min(1, valor)) : reserva;
    }
    contenedor.style.setProperty('--cursor-color-normal', color(opciones.colorNormal, '#ffffff'));
    contenedor.style.setProperty('--cursor-color-seleccionado', color(opciones.colorSeleccionado, '#ffffff'));
    contenedor.style.setProperty('--cursor-opacidad-normal', opacidad(opciones.opacidadNormal, 0.6));
    contenedor.style.setProperty('--cursor-opacidad-seleccionado', opacidad(opciones.opacidadSeleccionado, 0.65));

    contenedor.classList.add('con-cursor-de-piso');

    var circulo = global.document.createElement('div');
    circulo.className = 'cursor-piso';
    circulo.setAttribute('aria-hidden', 'true');
    contenedor.appendChild(circulo);

    // Aros fijos: se proyectan como círculos reales en el plano del suelo,
    // por lo que cambian de tamaño e inclinación al girar o hacer zoom.
    var capaAros = null;
    if (conAros) {
      capaAros = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      capaAros.setAttribute('class', 'hotspots-circulares');
      capaAros.setAttribute('aria-hidden', 'true');
      contenedor.appendChild(capaAros);
    }

    function pintarAros(medidas) {
      if (!capaAros) { return; }
      var hotspots = hotspotsDeLaEscena();
      while (capaAros.childNodes.length > hotspots.length) {
        capaAros.removeChild(capaAros.lastChild);
      }
      var ancho = medidas.ancho;
      var alto = medidas.alto;
      var yawVista = visor.getYaw() * GRADOS_A_RADIANES;
      var pitchVista = visor.getPitch() * GRADOS_A_RADIANES;
      var focal = ancho / 2 / Math.tan(visor.getHfov() * GRADOS_A_RADIANES / 2);
      hotspots.forEach(function (hotspot, indice) {
        var aro = capaAros.childNodes[indice];
        if (!aro) {
          aro = global.document.createElementNS('http://www.w3.org/2000/svg', 'path');
          capaAros.appendChild(aro);
        }
        var centro = aPlano(hotspot.distanciaM, hotspot.yaw);
        var altura = hotspot.distanciaM * Math.tan(hotspot.pitch * GRADOS_A_RADIANES);
        var puntos = [];
        // La banda tiene las mismas proporciones que el cursor móvil.
        // Proyectar ambos contornos hace que su grosor siga la perspectiva.
        for (var contorno = 0; contorno < 2; contorno++) {
          var radio = radioM * (contorno === 0 ? 0.98 : 0.84);
          for (var i = 0; i < 48; i++) {
            var angulo = 2 * Math.PI * i / 48;
            var x = centro.x + radio * Math.cos(angulo);
            var z = centro.y + radio * Math.sin(angulo);
            var lateral = x * Math.cos(yawVista) - z * Math.sin(yawVista);
            var profundidad = x * Math.sin(yawVista) + z * Math.cos(yawVista);
            var vertical = altura * Math.cos(pitchVista) - profundidad * Math.sin(pitchVista);
            var frente = altura * Math.sin(pitchVista) + profundidad * Math.cos(pitchVista);
            if (!(frente > 0.05)) { puntos = []; break; }
            puntos.push((i ? 'L' : 'M') + (ancho / 2 + focal * lateral / frente).toFixed(2) +
              ' ' + (alto / 2 - focal * vertical / frente).toFixed(2));
          }
          if (!puntos.length) { break; }
          puntos.push('Z');
        }
        aro.setAttribute('d', puntos.join(' '));
      });
    }

    var ultimoEvento = null;
    var movimientoPendiente = false;
    var hotspotActual = null;
    var inicioArrastre = null;
    var reenviando = false;

    function ocultar() {
      hotspotActual = null;
      contenedor.classList.remove('cursor-sobre-destino');
      circulo.style.display = 'none';
    }

    function hotspotsDeLaEscena() {
      var config = visor.getConfig();
      return (config && config.hotSpots) || [];
    }

    // Todo lo que el dibujo necesita leer del layout, leído de una vez y antes
    // de escribir nada. Leer una medida después de haber tocado un estilo
    // obliga al navegador a recalcular el layout en ese mismo instante, a
    // mitad de cuadro.
    function medir() {
      var lienzo = contenedor.querySelector('canvas');
      var recuadro = contenedor.getBoundingClientRect();
      return {
        ancho: contenedor.clientWidth,
        alto: contenedor.clientHeight,
        izquierda: recuadro.left,
        arriba: recuadro.top,
        anchoLienzo: lienzo ? lienzo.clientWidth : null
      };
    }

    function pintar(medidas) {
      if (!ultimoEvento) {
        return ocultar();
      }
      var coordenadas;
      try {
        coordenadas = visor.mouseEventToCoords(ultimoEvento);
      } catch (error) {
        // El visor todavía no tiene escena cargada.
        return ocultar();
      }
      var cabeceo = coordenadas[0];
      var yaw = coordenadas[1];

      var distancia = distanciaEnElSuelo(cabeceo, alturaM);
      if (!isFinite(distancia) || distancia > distanciaMaxima || distancia < distanciaMinima) {
        return ocultar();
      }

      if (medidas.anchoLienzo === null) {
        return ocultar();
      }
      // `hfov` se lee en cada movimiento del mouse y no se captura al
      // inicializar: el visitante puede hacer zoom, y con un hfov viejo el
      // círculo quedaría con el tamaño de otro nivel de zoom. El seguimiento
      // de la vista también lo actualiza sin mover el mouse.
      var focal = (medidas.anchoLienzo / 2) /
        Math.tan(visor.getHfov() * GRADOS_A_RADIANES / 2);
      var tamano = tamanoDeLaElipse(distancia, cabeceo, radioM, focal);
      if (tamano.rx < RADIO_MINIMO_PX) {
        return ocultar();
      }
      var radioMaximoPx = medidas.anchoLienzo * FRACCION_RADIO_MAXIMO;
      if (tamano.rx > radioMaximoPx) {
        var factor = radioMaximoPx / tamano.rx;
        tamano.rx = radioMaximoPx;
        tamano.ry = tamano.ry * factor;
      }

      hotspotActual = typeof opciones.sensibilidad === 'number' ? seleccionarHotspot(
        distancia, yaw, hotspotsDeLaEscena(), sensibilidad, distanciaMinima
      ) : hotspotBajoElCursor(distancia, yaw, hotspotsDeLaEscena(), fraccion);

      // El centro no se proyecta: es la posición del mouse. Así un error en
      // la aproximación del tamaño nunca mueve el círculo de lugar.
      var x = ultimoEvento.clientX - medidas.izquierda;
      var y = ultimoEvento.clientY - medidas.arriba;

      circulo.style.display = 'block';
      circulo.style.width = (2 * tamano.rx) + 'px';
      circulo.style.height = (2 * tamano.ry) + 'px';
      // Girar en el plano del suelo antes de aplicar el achatamiento del aro.
      circulo.style.setProperty('--cursor-flecha-tamano', (tamano.rx * 1.3) + 'px');
      circulo.style.setProperty('--cursor-flecha-escala', tamano.ry / tamano.rx);
      // Con `transform` y no con `left`/`top`: mover el círculo así no obliga
      // a recalcular el layout de la página en cada movimiento del mouse.
      circulo.style.transform = 'translate(' + (x - tamano.rx) + 'px, ' + (y - tamano.ry) + 'px)';
      circulo.style.setProperty('--cursor-desvanecimiento', Math.min(1,
        (distancia - distanciaMinima) / (alturaM * 0.2)));
      if (hotspotActual) {
        // Mismo rumbo relativo que las flechas centrales de direcciones.js.
        circulo.style.setProperty('--cursor-flecha-rumbo', (hotspotActual.yaw - visor.getYaw()) + 'deg');
        contenedor.classList.add('cursor-sobre-destino');
        circulo.classList.add('cursor-piso-activo');
      } else {
        contenedor.classList.remove('cursor-sobre-destino');
        circulo.classList.remove('cursor-piso-activo');
      }
    }

    function alMover(evento) {
      if (evento.target.closest && evento.target.closest(SELECTOR_CONTROLES)) {
        ultimoEvento = null;
        return ocultar();
      }
      ultimoEvento = evento;
      // El mouse puede reportar más movimientos que cuadros dibuja la
      // pantalla: se anota el último y se dibuja una vez, en el próximo
      // cuadro del bucle compartido.
      movimientoPendiente = true;
      vista.despertar();
    }

    function alSalir() {
      ultimoEvento = null;
      ocultar();
    }

    function alPresionar(evento) {
      inicioArrastre = {x: evento.clientX, y: evento.clientY};
    }

    function huboArrastre(evento) {
      if (!inicioArrastre) {
        return false;
      }
      var dx = evento.clientX - inicioArrastre.x;
      var dy = evento.clientY - inicioArrastre.y;
      return Math.sqrt(dx * dx + dy * dy) > UMBRAL_ARRASTRE_PX;
    }

    function alHacerClic(evento) {
      // El div del hotspot vive dentro del contenedor, así que el click
      // sintético burbujea de vuelta hasta acá. `.click()` es síncrono, así
      // que la bandera alcanza para cortar la recursión.
      if (reenviando || huboArrastre(evento)) {
        return;
      }
      if (evento.target.closest && evento.target.closest(SELECTOR_CONTROLES)) { return; }
      ultimoEvento = evento;
      pintar(medir());
      if (!hotspotActual || !hotspotActual.div) {
        return;
      }
      // Se reenvía el click en vez de llamar a `loadScene`: así el salto
      // conserva el `targetYaw: "sameAzimuth"` y el `targetPitch: "same"` que
      // el hotspot ya trae, sin duplicar esa semántica en dos lugares.
      reenviando = true;
      try {
        hotspotActual.div.click();
      } finally {
        reenviando = false;
      }
    }

    contenedor.addEventListener('mousemove', alMover);
    contenedor.addEventListener('mouseleave', alSalir);
    contenedor.addEventListener('mousedown', alPresionar);
    contenedor.addEventListener('click', alHacerClic);
    // Sin esto, `hotspotActual` queda con el hotspot (y el div) de la escena
    // anterior hasta el próximo `mousemove`: el círculo se ve azul porque el
    // dibujo también depende de un movimiento que todavía no llegó, pero un
    // clic ahí reenvía el clic a un div que ya no pertenece a la escena
    // actual y no navega a ningún lado. `mouseEventToCoords` usa el pitch/yaw
    // ya actualizados de la escena nueva en este punto: `pintar()` recalcula
    // con el mismo `ultimoEvento` (la posición de pantalla no cambió) pero
    // contra los hotspots correctos.
    visor.on('scenechange', function () {
      var medidas = medir();
      pintarAros(medidas);
      pintar(medidas);
    });
    visor.on('load', function () { pintarAros(medir()); });
    var vistaAnterior = '';
    vista.alCuadro(function () {
      var medidas = medir();
      var actual = [visor.getYaw(), visor.getPitch(), visor.getHfov(),
        medidas.ancho, medidas.alto].join('/');
      var cambioLaVista = actual !== vistaAnterior;
      if (cambioLaVista) {
        vistaAnterior = actual;
        pintarAros(medidas);
      }
      if (cambioLaVista || movimientoPendiente) {
        movimientoPendiente = false;
        pintar(medidas);
      }
    });
    pintarAros(medir());
    ocultar();

    // No hay un `detener()`: el tour es una página estática de una sola
    // pantalla, el visor nunca se destruye durante su vida y no existe
    // ningún evento de limpieza al que engancharlo — `plantilla.html` nunca
    // llegó a llamar a algo así. Un método que nadie invoca sería código
    // muerto disfrazado de API.
    return null;
  }

  global.iniciarCursorDePiso = iniciarCursorDePiso;
  // Expuestas para poder verificarlas desde la consola del navegador durante
  // la validación manual; el tour no las usa desde afuera.
  global.iniciarCursorDePiso.distanciaEnElSuelo = distanciaEnElSuelo;
  global.iniciarCursorDePiso.tamanoDeLaElipse = tamanoDeLaElipse;
  global.iniciarCursorDePiso.hotspotBajoElCursor = hotspotBajoElCursor;
  global.iniciarCursorDePiso.seleccionarHotspot = seleccionarHotspot;
})(window);
