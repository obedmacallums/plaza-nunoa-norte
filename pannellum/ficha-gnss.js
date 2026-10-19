/* Información geográfica del fotograma, independiente del giro del visor. */
(function (global) {
    'use strict';

    function iniciarFichaGnss(visor, contenedor, escenas, zonaHoraria) {
        var control = document.createElement('div');
        control.className = 'control-gnss';
        control.innerHTML =
            '<button type="button" class="boton-gnss pnlm-controls" ' +
            'aria-label="Coordenadas" title="Coordenadas" ' +
            'aria-expanded="false" aria-controls="ficha-gnss">' +
            '<svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" ' +
            'fill="none" stroke="currentColor" stroke-width="1.8">' +
            '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/>' +
            '<circle cx="12" cy="10" r="2.5"/></svg></button>' +
            '<section id="ficha-gnss" class="ficha-gnss" aria-label="Coordenadas" hidden>' +
            '<div class="cabecera-gnss"><strong>Coordenadas</strong>' +
            '<button type="button" class="cerrar-gnss" aria-label="Cerrar coordenadas">×</button></div>' +
            '<dl><dt>Longitud</dt><dd data-gnss="lon"></dd>' +
            '<dt>Latitud</dt><dd data-gnss="lat"></dd>' +
            '<dt>Altura</dt><dd data-gnss="alt"></dd>' +
            '<dt>Fecha y hora</dt><dd data-gnss="instante"></dd></dl>' +
            '<a class="mapa-gnss" target="_blank" rel="noopener noreferrer">Abrir en Google Maps ↗</a>' +
            '</section>';
        contenedor.appendChild(control);
        var boton = control.querySelector('.boton-gnss');
        var ficha = control.querySelector('.ficha-gnss');
        var mapa = control.querySelector('.mapa-gnss');

        function mostrar(abierta) {
            ficha.hidden = !abierta;
            boton.setAttribute('aria-expanded', String(abierta));
            // `tour.css` esconde con esto las flechas de dirección en el
            // celular: la ficha las taparía.
            contenedor.classList.toggle('ficha-gnss-abierta', abierta);
        }

        function numero(valor) {
            return typeof valor === 'number' && isFinite(valor);
        }

        function dos(n) { return (n < 10 ? '0' : '') + n; }

        // Las partes de la fecha en la zona elegida para el tour, o `null` si
        // el navegador no la conoce. No en la hora del visitante: daría otra
        // según quién mire.
        function partesEnZona(fecha, zona) {
            if (!zona || zona === 'UTC' || typeof Intl === 'undefined') { return null; }
            try {
                var partes = {};
                new Intl.DateTimeFormat('en-GB', {
                    timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit',
                    day: '2-digit', hour: '2-digit', minute: '2-digit'
                }).formatToParts(fecha).forEach(function (p) { partes[p.type] = p.value; });
                return partes;
            } catch (error) {
                return null;
            }
        }

        // «04-10-2026 12:32» en la zona del tour, sin nombrarla ni dar los
        // segundos: la ficha es angosta. En UTC —el tour no eligió zona o el
        // navegador no la conoce— sí lo dice, porque no es la hora del lugar.
        function fechaYHora(texto) {
            var f = new Date(texto);
            if (typeof texto !== 'string' || isNaN(f.getTime())) { return 'No disponible'; }
            var p = partesEnZona(f, zonaHoraria);
            if (p) {
                return p.day + '-' + p.month + '-' + p.year + ' ' + p.hour + ':' + p.minute;
            }
            return dos(f.getUTCDate()) + '-' + dos(f.getUTCMonth() + 1) + '-' + f.getUTCFullYear() +
                ' ' + dos(f.getUTCHours()) + ':' + dos(f.getUTCMinutes()) + ' UTC';
        }

        function actualizar() {
            var escena = escenas[visor.getScene()] || {};
            var datos = escena.gnss || {};
            ['lon', 'lat', 'alt'].forEach(function (clave) {
                var valor = datos[clave];
                var decimales = clave === 'alt' ? 1 : 6;
                control.querySelector('[data-gnss="' + clave + '"]').textContent =
                    numero(valor) ? valor.toFixed(decimales).replace('.', ',') +
                    (clave === 'alt' ? ' m' : '°') : 'No disponible';
            });
            control.querySelector('[data-gnss="instante"]').textContent = fechaYHora(datos.instante);
            var ubicacion = numero(datos.lat) && numero(datos.lon) &&
                Math.abs(datos.lat) <= 90 && Math.abs(datos.lon) <= 180;
            mapa.hidden = !ubicacion;
            if (ubicacion) {
                mapa.href = 'https://www.google.com/maps/search/?api=1&query=' +
                    encodeURIComponent(datos.lat + ',' + datos.lon);
            } else {
                mapa.removeAttribute('href');
            }
        }

        boton.addEventListener('click', function () { mostrar(ficha.hidden); });
        control.querySelector('.cerrar-gnss').addEventListener('click', function () {
            mostrar(false);
            boton.focus();
        });
        // Evita que interactuar con la ficha arrastre el panorama o navegue.
        ['pointerdown', 'mousedown', 'touchstart', 'dblclick', 'wheel', 'click'].forEach(function (tipo) {
            control.addEventListener(tipo, function (evento) { evento.stopPropagation(); });
        });
        control.addEventListener('keydown', function (evento) {
            evento.stopPropagation();
            if (evento.key === 'Escape') {
                mostrar(false);
                boton.focus();
            }
        });
        visor.on('scenechange', actualizar);
        actualizar();
    }

    global.iniciarFichaGnss = iniciarFichaGnss;
}(window));
