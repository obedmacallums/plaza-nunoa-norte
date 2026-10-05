/* Mapa de las escenas incluidas en el tour. Leaflet viaja con el visor;
 * únicamente el fondo cartográfico requiere conexión a OpenStreetMap. */
(function (global) {
    'use strict';
    var ZOOM_INICIAL = 18;

    function coordenadas(escena) {
        var g = escena && escena.gnss;
        return g && Number.isFinite(g.lat) && Number.isFinite(g.lon) &&
            Math.abs(g.lat) <= 85.05112878 && Math.abs(g.lon) <= 180 ?
            [g.lat, g.lon] : null;
    }

    /* Los tonos del tour, por si no llega ninguno.
     *
     * No es una copia decorativa de `paleta.js`: es el camino de un tour
     * generado antes de que la paleta existiera. El servidor de la vista
     * previa sirve los `.js` desde el código fuente para que una mejora se
     * vea sin regenerar el tour, pero el `index.html` sí es el que quedó en
     * disco, y ese no pide `paleta.js`. Sin esta reserva, abrir un tour ya
     * generado tiraba una excepción acá y se caía el visor entero. */
    var RESERVA = {trazo: '#1e90ff', punto: '#0b62c4', cono: '#1e90ff',
        conoRelleno: 0.25, conoBorde: 0.5};

    /* `paleta` la deriva `paleta.js` del color semilla del tour. Se recibe y
     * no se lee de las variables CSS porque Leaflet pinta la polilínea con un
     * atributo de presentación del SVG, que no acepta `var()`. */
    function iniciarMinimapa(visor, contenedor, escenas, paleta, vista) {
        var tonos = paleta ||
            (global.aplicarPaleta ? global.aplicarPaleta.derivar() : RESERVA);
        // Los identificadores del exportador son correlativos (0001, 0002…).
        // Ordenar explícitamente también cubre tours de más de 999 escenas:
        // JavaScript enumera primero las claves numéricas sin ceros iniciales.
        var puntos = Object.keys(escenas).sort(function (a, b) {
            return a.localeCompare(b, 'en', {numeric: true});
        }).map(function (id) { return coordenadas(escenas[id]); });
        var validos = puntos.filter(Boolean);
        if (!validos.length) return null;
        var control = document.createElement('section');
        control.className = 'minimapa minimapa-oculto';
        control.inert = true;
        control.setAttribute('aria-hidden', 'true');
        control.setAttribute('aria-label', 'Mapa del tour');
        control.innerHTML = '<div class="minimapa-lienzo" id="mapa-tour"></div>' +
            '<button type="button" class="minimapa-ampliar" aria-controls="mapa-tour" ' +
            'aria-expanded="false" aria-label="Ampliar mapa" title="Ampliar mapa">' +
            '<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" ' +
            'stroke="currentColor" stroke-width="2.5"><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/></svg></button>' +
            '<button type="button" class="minimapa-centrar" title="Centrar en el fotograma" aria-label="Centrar en el fotograma">⌖</button>' +
            '<button type="button" class="minimapa-trayecto" title="Ver todo el trayecto" aria-label="Ver todo el trayecto">↝</button>' +
            '<span class="minimapa-norte" title="Norte arriba" aria-label="Norte arriba">N ↑</span>' +
            '<span class="minimapa-estado" role="status" hidden></span>';
        contenedor.appendChild(control);
        var alternar = document.createElement('button');
        alternar.className = 'minimapa-alternar boton-gnss pnlm-controls';
        alternar.type = 'button';
        alternar.setAttribute('aria-controls', 'mapa-tour');
        alternar.setAttribute('aria-expanded', 'false');
        alternar.setAttribute('aria-label', 'Mostrar minimapa');
        alternar.title = 'Mostrar minimapa';
        alternar.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="26" height="26" ' +
            'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">' +
            '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z M9 3v16 M15 5v16"/></svg>';
        contenedor.appendChild(alternar);
        var visible = false;
        var boton = control.querySelector('button');
        var estado = control.querySelector('.minimapa-estado');
        var ampliado = false;
        var encima = false;
        var arrastrando = false;
        var tactil = false;
        var destruido = false;
        var esperaHover = null;
        var mapa = L.map(control.querySelector('.minimapa-lienzo'), {
            zoomControl: false, scrollWheelZoom: true, doubleClickZoom: true,
            dragging: true, touchZoom: true, boxZoom: true, keyboard: true,
            zoomAnimation: false, fadeAnimation: false, attributionControl: true
        });
        L.control.zoom({position: 'bottomright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar'}).addTo(mapa);
        mapa.attributionControl.setPrefix(false);
        var fondo = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19, keepBuffer: 0,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
        });
        fondo.on('tileerror', function () {
            estado.textContent = 'Mapa base no disponible'; estado.hidden = false;
        });
        fondo.on('tileload', function () { estado.hidden = true; });
        fondo.addTo(mapa);
        // Draw actual links: export order does not describe branches.
        var tramos = [], vistos = new Set();
        var ids = Object.keys(escenas);
        var tieneConexiones = ids.some(function (id) {
            return Array.isArray(escenas[id].hotSpots);
        });
        if (tieneConexiones) {
            ids.forEach(function (id) {
                var origen = coordenadas(escenas[id]);
                (escenas[id].hotSpots || []).forEach(function (salto) {
                    var destino = coordenadas(escenas[salto.sceneId]);
                    if (salto.type !== 'scene' || !origen || !destino || id === salto.sceneId) return;
                    var clave = JSON.stringify([id, salto.sceneId].sort());
                    if (vistos.has(clave)) return;
                    vistos.add(clave);
                    tramos.push([origen, destino]);
                });
            });
        } else {
            // Legacy data without connections: break at missing coordinates.
            var tramo = [];
            puntos.forEach(function (p) {
                if (p) tramo.push(p);
                else if (tramo.length) { tramos.push(tramo); tramo = []; }
            });
            if (tramo.length) tramos.push(tramo);
        }
        var recorrido = L.polyline(tramos, {
            color: tonos.trazo, weight: 3, opacity: 0.55, lineCap: 'round', interactive: false
        }).addTo(mapa);
        var simbolo = document.createElement('div');
        simbolo.innerHTML = '<svg viewBox="0 0 80 80" width="80" height="80" aria-hidden="true">' +
            '<path class="minimapa-cono" fill="' + tonos.cono + '" fill-opacity="' + tonos.conoRelleno +
            '" stroke="' + tonos.cono + '" stroke-opacity="' + tonos.conoBorde + '"/>' +
            '<circle class="minimapa-punto" cx="40" cy="40" r="6" fill="' + tonos.punto +
            '" stroke="white" stroke-width="2"/>' +
            '</svg>';
        var cono = simbolo.querySelector('.minimapa-cono');
        var marcador = L.marker(validos[0], {
            icon: L.divIcon({html: simbolo, className: 'minimapa-orientacion', iconSize: [80, 80], iconAnchor: [40, 40]}),
            interactive: false, keyboard: false
        });
        var ultimaOrientacion = '';
        function orientar() {
            // Oculto no hay cono que se vea: se lo orienta al mostrarlo.
            if (!visible) return;
            var escena = escenas[visor.getScene()] || {};
            var rumbo = escena.gnss && escena.gnss.rumbo;
            var yaw = visor.getYaw();
            var hfov = visor.getHfov();
            var clave = [escena.northOffset, rumbo, yaw, hfov].join('/');
            if (clave === ultimaOrientacion) return;
            ultimaOrientacion = clave;
            // northOffset es el acimut del centro del panorama; yaw es el
            // giro relativo a ese centro. El norte del mapa permanece arriba.
            var norte = Number.isFinite(escena.northOffset) ? escena.northOffset : rumbo;
            var vistaValida = Number.isFinite(norte) && Number.isFinite(yaw) && Number.isFinite(hfov);
            cono.style.display = vistaValida ? '' : 'none';
            if (vistaValida) {
                var mitad = Math.max(1, Math.min(179, hfov)) * Math.PI / 360;
                var dx = 36 * Math.sin(mitad), dy = 36 * Math.cos(mitad);
                cono.setAttribute('d', 'M40 40L' + (40 - dx) + ' ' + (40 - dy) +
                    'A36 36 0 0 1 ' + (40 + dx) + ' ' + (40 - dy) + 'Z');
                cono.setAttribute('transform', 'rotate(' + (((norte + yaw) % 360 + 360) % 360) + ' 40 40)');
            }
        }
        function redimensionar() {
            mapa.invalidateSize({pan: true, animate: false});
        }
        function centrar(restablecerZoom) {
            var punto = coordenadas(escenas[visor.getScene()]);
            if (punto) mapa.setView(punto, restablecerZoom === true ? ZOOM_INICIAL : mapa.getZoom(), {animate: false});
        }
        function actualizar() {
            var punto = coordenadas(escenas[visor.getScene()]);
            if (punto) marcador.setLatLng(punto).addTo(mapa);
            else mapa.removeLayer(marcador);
            ultimaOrientacion = '';
            orientar();
            if (!ampliado) centrar(true);
        }
        function mostrar(valor) {
            cancelarHover();
            if (valor && !visible) return;
            if (ampliado === valor) return;
            ampliado = valor;
            control.classList.toggle('minimapa-ampliado', valor);
            // `tour.css` esconde con esto las flechas de dirección en el
            // celular: el mapa ampliado y ellas ocupan el mismo lugar.
            contenedor.classList.toggle('mapa-ampliado', valor);
            boton.setAttribute('aria-expanded', String(valor));
            boton.setAttribute('aria-label', valor ? 'Reducir mapa' : 'Ampliar mapa');
            boton.title = valor ? 'Reducir mapa' : 'Ampliar mapa';
            recorrido.setStyle({weight: valor ? 4 : 3, opacity: valor ? 0.85 : 0.55});
            redimensionar();
            if (!valor) centrar(true);
        }
        boton.addEventListener('click', function () { mostrar(!ampliado); });
        alternar.addEventListener('click', function () {
            visible = !visible;
            encima = false;
            mostrar(false);
            control.inert = !visible;
            control.setAttribute('aria-hidden', String(!visible));
            control.classList.toggle('minimapa-oculto', !visible);
            alternar.setAttribute('aria-expanded', String(visible));
            alternar.title = visible ? 'Ocultar minimapa' : 'Mostrar minimapa';
            alternar.setAttribute('aria-label', alternar.title);
            if (visible) { redimensionar(); centrar(true); ultimaOrientacion = ''; orientar(); }
        });
        ['pointerdown', 'mousedown', 'touchstart', 'dblclick', 'wheel', 'click', 'keydown', 'keyup'].forEach(function (tipo) {
            alternar.addEventListener(tipo, function (e) { e.stopPropagation(); });
        });
        function cancelarHover() {
            global.clearTimeout(esperaHover);
            esperaHover = null;
        }
        control.addEventListener('pointerdown', function (e) { tactil = e.pointerType === 'touch'; });
        control.addEventListener('pointerenter', function (e) {
            if (e.pointerType === 'touch' || !visible) return;
            encima = true;
            cancelarHover();
            // Una pasada accidental del puntero no debe desplegar el mapa.
            esperaHover = global.setTimeout(function () {
                if (encima && !destruido) mostrar(true);
            }, 250);
        });
        control.addEventListener('pointerleave', function (e) {
            if (e.pointerType === 'touch') return;
            encima = false;
            cancelarHover();
            if (!arrastrando) mostrar(false);
        });
        mapa.on('dragstart', function () { arrastrando = true; });
        mapa.on('dragend', function () {
            arrastrando = false;
            if (!encima && !tactil) mostrar(false);
        });
        control.querySelector('.minimapa-centrar').addEventListener('click', centrar);
        control.querySelector('.minimapa-trayecto').addEventListener('click', function () {
            mostrar(true);
            mapa.fitBounds(L.latLngBounds(validos), {padding: [45, 45], maxZoom: 18, animate: false});
        });
        control.addEventListener('focusin', function (e) {
            // El botón conserva el toggle para teclado y pantallas táctiles.
            if (e.target !== boton) mostrar(true);
        });
        control.addEventListener('focusout', function (e) {
            if (!encima && !control.contains(e.relatedTarget)) mostrar(false);
        });
        ['pointerdown', 'mousedown', 'touchstart', 'dblclick', 'wheel', 'click', 'keyup'].forEach(function (tipo) {
            control.addEventListener(tipo, function (e) { e.stopPropagation(); });
        });
        control.addEventListener('keydown', function (e) {
            e.stopPropagation();
            if (e.key === 'Escape') { mostrar(false); boton.focus(); }
        });
        var observador = new ResizeObserver(redimensionar);
        observador.observe(control);
        visor.on('scenechange', actualizar);
        mapa.setView(coordenadas(escenas[visor.getScene()]) || validos[0], ZOOM_INICIAL, {animate: false});
        actualizar();
        var dejarDeSeguir = vista.alCuadro(orientar);
        return {destroy: function () {
            destruido = true;
            cancelarHover();
            dejarDeSeguir();
            observador.disconnect();
            visor.off('scenechange', actualizar);
            mapa.remove();
            control.remove();
            alternar.remove();
        }};
    }
    global.iniciarMinimapa = iniciarMinimapa;
}(window));
