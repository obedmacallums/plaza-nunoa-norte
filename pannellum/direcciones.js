/* Rosa de navegación: destinos alrededor del observador, incluso fuera de vista.
 * Independiente de la selección de vecinos y de los hotspots del panorama. */
(function (global) {
  'use strict';

  // No iniciar un arrastre del panorama al tocar un control. El espacio entre
  // botones sigue siendo transparente a los gestos del visor.
  function aislarGestos(elemento) {
    ['pointerdown', 'mousedown', 'touchstart', 'dblclick'].forEach(function (tipo) {
      elemento.addEventListener(tipo, function (evento) { evento.stopPropagation(); });
    });
  }

  // La misma condición que usa `tour.css` para ocultar los íconos de los
  // destinos, y la contraria a `HAY_HOVER` de `cursor-piso.js`.
  var SIN_HOVER = '(hover: none)';

  function iniciarDirecciones(visor, contenedor, vista) {
    var panel = document.createElement('nav');
    panel.className = 'direcciones-tour';
    panel.id = 'direcciones-tour';
    panel.setAttribute('aria-label', 'Direcciones disponibles');
    contenedor.appendChild(panel);
    var botones = [];
    var escena = null;
    var anteriorYaw = null;
    // En escritorio arrancan ocultas: se dibujan sobre el centro de la imagen,
    // que es justamente lo que se está mirando, y ahí el cursor de piso ya
    // navega. En un dispositivo sin hover (el celular) son la única forma de
    // navegar, porque los íconos de cada destino se ocultan (`tour.css`): ahí
    // arrancan visibles.
    var visibles = Boolean(global.matchMedia && global.matchMedia(SIN_HOVER).matches);

    // El interruptor vive en la misma columna que la brújula y la ficha GNSS,
    // y usa su misma clase de apariencia (`boton-gnss pnlm-controls`): es un
    // control más del visor, no un adorno de la rosa.
    var alternar = document.createElement('button');
    alternar.type = 'button';
    alternar.className = 'direcciones-alternar boton-gnss pnlm-controls';
    alternar.setAttribute('aria-controls', 'direcciones-tour');
    // Una flecha a secas, con los mismos atributos de trazo que los iconos
    // vecinos de la columna. Que esté activo lo dice el color, igual que en
    // ellos: no lleva ninguna marca propia encima.
    alternar.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" ' +
      'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
      'stroke-linejoin="round"><path d="M5 19 18 6m0 6V6h-6"/></svg>';
    contenedor.appendChild(alternar);

    aislarGestos(panel);
    aislarGestos(alternar);

    // Un único lugar decide si la rosa se ve: ocultarla a mano en `reconstruir`
    // la haría reaparecer sola en la siguiente escena.
    function aplicarVisibilidad() {
      panel.hidden = !visibles || botones.length === 0;
      // `aria-expanded` y no `aria-pressed`: es el mismo atributo con el que
      // el minimapa y la ficha GNSS dicen que su panel está abierto, y de él
      // cuelga en `tour.css` el azul que los marca activos.
      alternar.setAttribute('aria-expanded', String(visibles));
      var texto = visibles ? 'Ocultar flechas de dirección' : 'Mostrar flechas de dirección';
      alternar.setAttribute('aria-label', texto);
      alternar.title = texto;
    }

    function reconstruir() {
      while (panel.firstChild) { panel.removeChild(panel.firstChild); }
      botones = [];
      var config = visor.getConfig();
      (config.hotSpots || []).forEach(function (hotspot) {
        if (hotspot.type !== 'scene' || !hotspot.sceneId ||
            typeof hotspot.yaw !== 'number' || !isFinite(hotspot.yaw)) { return; }
        var boton = document.createElement('button');
        boton.type = 'button';
        boton.className = 'direccion-tour';
        var texto = hotspot.text || 'Ir a panorama cercano';
        boton.setAttribute('aria-label', texto);
        var flecha = document.createElement('span');
        flecha.className = 'direccion-tour-flecha';
        flecha.setAttribute('aria-hidden', 'true');
        boton.appendChild(flecha);
        // Etiqueta propia y no `title`: el tooltip nativo sale con el fondo
        // claro del sistema, y esta lleva el gris translúcido de la ficha.
        var etiqueta = document.createElement('span');
        etiqueta.className = 'direccion-tour-texto';
        etiqueta.setAttribute('aria-hidden', 'true');
        etiqueta.textContent = texto;
        boton.appendChild(etiqueta);
        boton.addEventListener('click', function (evento) {
          evento.stopPropagation();
          // Mismos destinos y conservación del rumbo que los hotspots.
          visor.loadScene(hotspot.sceneId, 'same', 'sameAzimuth');
        });
        panel.appendChild(boton);
        botones.push({ elemento: boton, yaw: hotspot.yaw });
      });
      aplicarVisibilidad();
      anteriorYaw = null;
    }

    function actualizar() {
      if (escena !== visor.getScene()) {
        escena = visor.getScene();
        reconstruir();
      }
      // Con la rosa oculta no hay nada que orientar: seguir escribiendo `left`
      // y `top` en cada frame sería trabajo que nadie ve.
      if (visibles) {
        var yaw = visor.getYaw();
        // El tamaño del panel se lee antes de escribir nada: leerlo después
        // obligaría a recalcular el layout a mitad de cuadro. Entra en la
        // comparación porque el panel cambia de tamaño con la ventana.
        var ancho = panel.clientWidth;
        var alto = panel.clientHeight;
        var clave = yaw + '/' + ancho + '/' + alto;
        if (clave !== anteriorYaw) {
          botones.forEach(function (boton) {
            var angulo = (boton.yaw - yaw) * Math.PI / 180;
            // Elipse de suelo: norte arriba, derecha a la derecha. El tamaño
            // pertenece al panel; no depende de la distancia del destino.
            // Con `transform` y no con `left`/`top`, que obligarían a
            // recalcular el layout en cada cuadro del giro.
            var x = ancho * (0.5 + 0.37 * Math.sin(angulo));
            var y = alto * (0.5 - 0.34 * Math.cos(angulo));
            boton.elemento.style.transform =
              'translate(' + x + 'px, ' + y + 'px) translate(-50%, -50%)';
            boton.elemento.style.setProperty('--direccion', (boton.yaw - yaw) + 'deg');
          });
          anteriorYaw = clave;
        }
      }
    }

    alternar.addEventListener('click', function (evento) {
      evento.stopPropagation();
      visibles = !visibles;
      // Al volver se reorienta aunque la vista no se haya movido: mientras
      // estuvo oculta el yaw pudo cambiar sin que nadie moviera las flechas.
      anteriorYaw = null;
      aplicarVisibilidad();
      vista.despertar();
    });

    aplicarVisibilidad();
    visor.on('load', reconstruir);
    actualizar();
    var dejarDeSeguir = vista.alCuadro(actualizar);
    return function detener() {
      dejarDeSeguir();
      visor.off('load', reconstruir);
      panel.remove();
      alternar.remove();
    };
  }

  global.iniciarDirecciones = iniciarDirecciones;
})(window);
