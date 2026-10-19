/* Precarga de las escenas vecinas: que un salto no tenga que esperar a la red.
 *
 * Pannellum pide los mosaicos de una escena recién cuando se entra a ella, y
 * el fundido arranca sobre algo que todavía no llegó. Acá se piden en segundo
 * plano los niveles más bajos de los destinos de la escena actual, y el más
 * bajo también de los destinos de esos destinos, para cuando se avanza
 * varias fotos seguidas. Pannellum dibuja una escena de menor a mayor nivel, así que con
 * esos niveles ya en memoria el salto muestra la foto enseguida y la afina a
 * medida que llegan los mosaicos más grandes.
 *
 * La ruta de cada mosaico se arma igual que en Pannellum: `basePath` + `path`
 * con `%s`, `%l`, `%y` y `%x` reemplazados + `.` + `extension`.
 */
(function (global) {
  'use strict';

  // Las mismas letras con las que `tiles.py` nombra las caras.
  var CARAS = ['f', 'b', 'u', 'd', 'l', 'r'];

  // Con mosaicos, Pannellum emite `load` en cuanto arma la escena, antes de
  // que lleguen sus propios mosaicos. Lo que pesa —el nivel 2 de las
  // vecinas— espera este rato para dejarles la red a ellos.
  var ESPERA_MS = 1000;

  function rutasDelNivel(escena, nivel) {
    var multiRes = escena && escena.multiRes;
    if (!multiRes || typeof multiRes.path !== 'string' ||
        !(multiRes.cubeResolution > 0) || !(multiRes.tileResolution > 0) ||
        !(nivel >= 1 && nivel <= multiRes.maxLevel)) {
      return [];
    }
    // Misma aritmética que `tiles.py`: el nivel máximo es la cara entera y
    // cada nivel hacia abajo tiene la mitad.
    var tamano = multiRes.cubeResolution;
    for (var n = multiRes.maxLevel; n > nivel; n--) {
      tamano = Math.floor(tamano / 2);
    }
    var cantidad = Math.ceil(tamano / multiRes.tileResolution);
    var base = multiRes.basePath || '';
    var rutas = [];
    CARAS.forEach(function (cara) {
      for (var fila = 0; fila < cantidad; fila++) {
        for (var columna = 0; columna < cantidad; columna++) {
          rutas.push(base + multiRes.path.replace('%s', cara).replace('%l', nivel)
            .replace('%x', columna).replace('%y', fila) + '.' + multiRes.extension);
        }
      }
    });
    return rutas;
  }

  function destinosDe(hotspots) {
    return (hotspots || []).filter(function (hotspot) {
      return hotspot.type === 'scene' && hotspot.sceneId;
    }).map(function (hotspot) { return hotspot.sceneId; });
  }

  function iniciarPrecarga(visor, escenas) {
    // Las imágenes se guardan hasta el próximo cambio de escena: soltarlas
    // antes deja que el navegador las descarte de memoria sin usarlas.
    var retenidas = [];
    var pedidas = {};
    var pendiente = null;

    function pedir(escena, nivel, prioridad) {
      rutasDelNivel(escenas[escena], nivel).forEach(function (ruta) {
        if (pedidas[ruta]) { return; }
        pedidas[ruta] = true;
        var imagen = new global.Image();
        // Pannellum pide los mosaicos con `crossOrigin = "anonymous"`. La
        // caché de imágenes del documento los distingue por ese modo, y una
        // precarga sin él no le serviría de nada.
        imagen.crossOrigin = 'anonymous';
        if ('fetchPriority' in imagen) { imagen.fetchPriority = prioridad; }
        imagen.decoding = 'async';
        imagen.src = ruta;
        retenidas.push(imagen);
      });
    }

    function precargar() {
      var actual = visor.getScene();
      var config = visor.getConfig();
      var vecinas = destinosDe(config && config.hotSpots).filter(function (id) {
        return id !== actual && escenas[id];
      });
      var segundas = [];
      vecinas.forEach(function (vecina) {
        destinosDe(escenas[vecina].hotSpots).forEach(function (id) {
          if (id !== actual && vecinas.indexOf(id) === -1 &&
              segundas.indexOf(id) === -1 && escenas[id]) {
            segundas.push(id);
          }
        });
      });
      retenidas = [];
      pedidas = {};
      // Ya, sin esperar: el nivel 1, una cara entera en un mosaico chico.
      // Con él, llegar a la escena nunca es llegar a una pantalla negra, por
      // rápido que se avance. Las vecinas directas con la prioridad de
      // siempre, para que no queden detrás de los mosaicos grandes de la
      // escena actual; las que están a dos saltos, con prioridad baja.
      vecinas.forEach(function (id) { pedir(id, 1, 'auto'); });
      segundas.forEach(function (id) { pedir(id, 1, 'low'); });
      // Después, el nivel 2 de las vecinas directas: con él la foto ya se lee.
      // Más arriba el costo crece de a cuatro por nivel para algo que
      // Pannellum pide igual en cuanto se entra.
      global.clearTimeout(pendiente);
      pendiente = global.setTimeout(function () {
        vecinas.forEach(function (id) { pedir(id, 2, 'low'); });
      }, ESPERA_MS);
    }

    visor.on('load', precargar);
    if (visor.isLoaded && visor.isLoaded()) { precargar(); }
  }

  global.iniciarPrecarga = iniciarPrecarga;
  global.iniciarPrecarga.rutasDelNivel = rutasDelNivel;
})(window);
