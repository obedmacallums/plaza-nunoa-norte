/* El contorno de la zona tratada: dónde estaba la máscara que se rellenó.
 *
 * Cada escena con máscara trae `mascara.png` junto a sus mosaicos: la zona
 * tratada en escala de grises, suavizada, sobre una equirectangular entera.
 * Acá se dibuja su borde encima del panorama, en una sola pasada de WebGL 2:
 * para cada píxel de la pantalla se calcula hacia dónde mira, se lee la
 * imagen en esa dirección y se traza una línea donde el valor cruza la mitad.
 *
 * Se dibuja en el fragment shader y no como polígonos porque la zona casi
 * siempre rodea al nadir: proyectada como línea, su contorno da la vuelta a
 * todo el panorama y se corta detrás de la cámara. Así no hay caso especial.
 * El grosor sale de `fwidth`, cuánto cambia el valor por píxel de pantalla, y
 * por eso es el mismo al acercarse o alejarse.
 *
 * La proyección es la de Pannellum: perspectiva con `hfov` horizontal, y la
 * dirección `(yaw, pitch)` hacia el centro. Esa vista no se lee con
 * `getPitch()` y compañía, sino que se recibe de Pannellum en el mismo
 * instante en que la dibuja (`visor.alRenderizar`, un gancho que se le agregó
 * al visor vendorizado): durante un arrastre, y sobre todo con el dedo, el
 * gesto escribe el cabeceo y el giro tal cual los pide y Pannellum los limita
 * recién al dibujar, así que cualquier lectura previa puede estar adelantada
 * respecto de lo que se ve, y el contorno se despegaba de la imagen. La equirectangular usa la misma
 * convención que `cubemap.py`: acimut desde el centro de la imagen creciendo
 * a la derecha, elevación positiva hacia arriba.
 *
 * Sin WebGL 2 el botón ni aparece: es un complemento, y no vale un segundo
 * camino de dibujo.
 *
 * ES5 a propósito, como el resto de los módulos del tour.
 */
(function (global) {
  'use strict';

  var ARCHIVO = 'mascara.png';

  // Medio ancho, en píxeles CSS: la línea mide 1,6 y el halo oscuro que la
  // separa del fondo sobresale a cada lado. Sobre asfalto claro, una línea de
  // color sin halo se pierde.
  var MEDIO_TRAZO = 0.8;
  var MEDIO_HALO = 2.0;
  var OPACIDAD_HALO = 0.45;

  var VERTICE = '#version 300 es\n' +
    'void main() {\n' +
    // Un triángulo que cubre la pantalla, sin buffers.
    '  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n' +
    '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n' +
    '}\n';

  var FRAGMENTO = '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform sampler2D uMascara;\n' +
    'uniform vec2 uResolucion;\n' +
    'uniform vec2 uGiro;\n' +
    'uniform float uTangente;\n' +
    'uniform vec3 uColor;\n' +
    'uniform vec2 uAncho;\n' +
    'out vec4 salida;\n' +
    'const float PI = 3.14159265358979;\n' +
    'void main() {\n' +
    '  vec2 n = gl_FragCoord.xy / uResolucion * 2.0 - 1.0;\n' +
    '  vec3 c = vec3(n.x * uTangente, n.y * uTangente * uResolucion.y / uResolucion.x, 1.0);\n' +
    '  float cp = cos(uGiro.y), sp = sin(uGiro.y);\n' +
    '  vec3 d = vec3(c.x, c.y * cp + c.z * sp, -c.y * sp + c.z * cp);\n' +
    '  float cy = cos(uGiro.x), sy = sin(uGiro.x);\n' +
    '  d = normalize(vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy));\n' +
    '  vec2 uv = vec2(atan(d.x, d.z) / (2.0 * PI) + 0.5,\n' +
    '                 0.5 - asin(clamp(d.y, -1.0, 1.0)) / PI);\n' +
    '  float m = texture(uMascara, uv).r;\n' +
    // Distancia en píxeles de pantalla hasta donde el valor cruza 0,5.
    '  float dist = abs(m - 0.5) / max(fwidth(m), 1e-5);\n' +
    '  float trazo = clamp(uAncho.x - dist + 0.5, 0.0, 1.0);\n' +
    '  float halo = clamp(uAncho.y - dist + 0.5, 0.0, 1.0) * ' + OPACIDAD_HALO.toFixed(2) + ';\n' +
    // Alfa premultiplicado: el halo es negro, no suma color.
    '  salida = vec4(uColor * trazo, trazo + halo * (1.0 - trazo));\n' +
    '}\n';

  // No iniciar un arrastre del panorama al tocar el botón.
  function aislarGestos(elemento) {
    ['pointerdown', 'mousedown', 'touchstart', 'dblclick'].forEach(function (tipo) {
      elemento.addEventListener(tipo, function (evento) { evento.stopPropagation(); });
    });
  }

  function aRgb(hex) {
    return [1, 3, 5].map(function (i) { return parseInt(hex.slice(i, i + 2), 16) / 255; });
  }

  function compilar(gl, tipo, fuente) {
    var sombreador = gl.createShader(tipo);
    gl.shaderSource(sombreador, fuente);
    gl.compileShader(sombreador);
    if (!gl.getShaderParameter(sombreador, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sombreador));
    }
    return sombreador;
  }

  function crearPrograma(gl) {
    var programa = gl.createProgram();
    gl.attachShader(programa, compilar(gl, gl.VERTEX_SHADER, VERTICE));
    gl.attachShader(programa, compilar(gl, gl.FRAGMENT_SHADER, FRAGMENTO));
    gl.linkProgram(programa);
    if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(programa));
    }
    return programa;
  }

  /* `escenas` es `pannellum.scenes` (de ahí sale la carpeta de cada una) y
   * `conContorno` los identificadores de las que traen `mascara.png`. Devuelve
   * la función que lo desmonta, o `null` si no hay nada que mostrar o el
   * navegador no puede dibujarlo. */
  function iniciarContornoMascara(visor, contenedor, escenas, conContorno, paleta, vista) {
    var tienen = {};
    (conContorno || []).forEach(function (id) { tienen[id] = true; });
    if (!Object.keys(tienen).length) { return null; }

    var documento = global.document;
    var lienzo = documento.createElement('canvas');
    var gl = lienzo.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false
    });
    if (!gl) { return null; }
    var programa;
    try {
      programa = crearPrograma(gl);
    } catch (error) {
      global.console.error('El contorno de la máscara no pudo iniciarse:', error);
      return null;
    }
    gl.useProgram(programa);
    var uniformes = {};
    ['uMascara', 'uResolucion', 'uGiro', 'uTangente', 'uColor', 'uAncho'].forEach(function (nombre) {
      uniformes[nombre] = gl.getUniformLocation(programa, nombre);
    });
    var color = aRgb(paleta.acento);
    gl.uniform3f(uniformes.uColor, color[0], color[1], color[2]);
    gl.uniform1i(uniformes.uMascara, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    var textura = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, textura);
    // La vuelta completa de la esfera cierra sobre sí misma: REPEAT en el
    // acimut. En vertical no hay nada más allá de los polos.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    lienzo.className = 'contorno-mascara';
    lienzo.setAttribute('aria-hidden', 'true');
    lienzo.hidden = true;
    contenedor.appendChild(lienzo);

    var alternar = documento.createElement('button');
    alternar.type = 'button';
    alternar.className = 'contorno-alternar boton-gnss pnlm-controls';
    alternar.setAttribute('aria-controls', 'contorno-mascara');
    lienzo.id = 'contorno-mascara';
    // Un borde punteado de forma irregular, con los atributos de trazo de los
    // iconos vecinos. Que esté activo lo dice el color, igual que en ellos.
    alternar.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" ' +
      'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
      'stroke-linejoin="round" stroke-dasharray="3.2 2.6"><path d="M4.5 13.5C4 8.5 8 5 12.5 ' +
      '5.5c4 .4 7.5 3 7 7.5-.4 3.8-3.6 6-7.6 5.8-4.4-.2-7.9-1.9-7.4-5.3z"/></svg>';
    contenedor.appendChild(alternar);
    aislarGestos(alternar);

    var visibles = false;
    // La escena cuya imagen está en la textura, la que se está bajando y las
    // que fallaron (para no reintentar en cada cuadro).
    var cargada = null;
    var pidiendo = null;
    var fallidas = {};
    var anterior = null;
    // La última vista que Pannellum dibujó: `{ yaw, pitch, hfov }`.
    var ultimo = null;

    function aplicarVisibilidad() {
      alternar.setAttribute('aria-expanded', String(visibles));
      var texto = visibles ? 'Ocultar área editada' : 'Mostrar área editada';
      alternar.setAttribute('aria-label', texto);
      alternar.title = texto;
    }

    function ruta(id) {
      var escena = escenas && escenas[id];
      var base = escena && escena.multiRes && escena.multiRes.basePath;
      return (base || 'escenas/' + id) + '/' + ARCHIVO;
    }

    function pedir(id) {
      pidiendo = id;
      var imagen = new global.Image();
      imagen.onload = function () {
        if (pidiendo !== id) { return; }
        pidiendo = null;
        gl.bindTexture(gl.TEXTURE_2D, textura);
        // La imagen es un valor, no un color: sin conversión ni premultiplicado.
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, imagen);
        cargada = id;
        anterior = null;
        vista.despertar();
      };
      imagen.onerror = function () {
        if (pidiendo === id) { pidiendo = null; }
        fallidas[id] = true;
      };
      imagen.src = ruta(id);
    }

    function dibujar(escena) {
      var proporcion = global.devicePixelRatio || 1;
      var ancho = Math.max(1, Math.round(contenedor.clientWidth * proporcion));
      var alto = Math.max(1, Math.round(contenedor.clientHeight * proporcion));
      var yaw = ultimo.yaw;
      var hfov = ultimo.hfov;
      var pitch = ultimo.pitch;
      var clave = [escena, yaw, pitch, hfov, ancho, alto].join('/');
      if (clave === anterior) { return; }
      anterior = clave;
      if (lienzo.width !== ancho || lienzo.height !== alto) {
        lienzo.width = ancho;
        lienzo.height = alto;
      }
      gl.viewport(0, 0, ancho, alto);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textura);
      gl.uniform2f(uniformes.uResolucion, ancho, alto);
      gl.uniform2f(uniformes.uGiro, yaw * Math.PI / 180, pitch * Math.PI / 180);
      gl.uniform1f(uniformes.uTangente, Math.tan(hfov * Math.PI / 360));
      gl.uniform2f(uniformes.uAncho, MEDIO_TRAZO * proporcion, MEDIO_HALO * proporcion);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function actualizar() {
      var escena = visor.getScene();
      if (!visibles) { return; }
      if (tienen[escena] && cargada !== escena && pidiendo !== escena && !fallidas[escena]) {
        pedir(escena);
      }
      // Solo se dibuja sobre la escena a la que pertenece la imagen: mientras
      // se baja la siguiente, o durante el salto, el contorno viejo no se ve.
      var listo = Boolean(tienen[escena]) && cargada === escena && visor.isLoaded();
      if (lienzo.hidden === listo) {
        lienzo.hidden = !listo;
        anterior = null;
      }
      if (listo && ultimo) { dibujar(escena); }
    }

    alternar.addEventListener('click', function (evento) {
      evento.stopPropagation();
      visibles = !visibles;
      if (!visibles) { lienzo.hidden = true; }
      anterior = null;
      aplicarVisibilidad();
      vista.despertar();
    });

    visor.alRenderizar = function (pitch, yaw, hfov) {
      ultimo = { yaw: yaw, pitch: pitch, hfov: hfov };
      actualizar();
    };

    aplicarVisibilidad();
    var dejarDeSeguir = vista.alCuadro(actualizar);
    return function detener() {
      visor.alRenderizar = null;
      dejarDeSeguir();
      lienzo.remove();
      alternar.remove();
    };
  }

  global.iniciarContornoMascara = iniciarContornoMascara;
})(window);
