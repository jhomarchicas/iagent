
const $ = id => document.getElementById(id);

let modelos = [];
let estadoActual = {
    running: false,
    starting: false,
    model: null
};

function obtenerModelo(id) {
    return modelos.find(modelo => modelo.id === id);
}

function actualizarEstado(estado) {
    estadoActual = estado;

    const activo = estado.running || estado.starting;

    $('start').disabled = activo || !modelos.length;
    $('stop').disabled = !activo;

    $('provider').disabled = activo;
    $('model').disabled = activo;

    $('status').textContent = estado.starting
        ? '● Iniciando...'
        : estado.running
            ? '● En ejecución'
            : '● Detenido';

    $('status').classList.toggle('running', activo);

    if (estado.model) {
        const modelo = obtenerModelo(estado.model);

        if (modelo) {
            $('model-name').textContent = modelo.name;
            $('model-provider').textContent = modelo.providerName;
        }
    }
}

function agregarLog(
    mensaje,
    nivel = 'info',
    hora = new Date().toLocaleTimeString()
) {
    const entrada = document.createElement('div');
    entrada.className = `entry ${nivel}`;

    const tiempo = document.createElement('time');
    tiempo.textContent = hora;

    entrada.append(
        tiempo,
        document.createTextNode(mensaje)
    );

    $('logs').prepend(entrada);

    while ($('logs').children.length > 100) {
        $('logs').lastChild.remove();
    }
}

function configurarProveedor() {
    const proveedores = [
        ...new Map(
            modelos.map(modelo => [
                modelo.provider,
                {
                    id: modelo.provider,
                    name: modelo.providerName
                }
            ])
        ).values()
    ];

    $('provider').replaceChildren();

    for (const proveedor of proveedores) {
        const opcion = document.createElement('option');
        opcion.value = proveedor.id;
        opcion.textContent = proveedor.name;
        $('provider').append(opcion);
    }
}

function configurarModelos(preferido = null) {
    const disponibles = modelos.filter(
        modelo => modelo.provider === $('provider').value
    );

    $('model').replaceChildren();

    for (const modelo of disponibles) {
        const opcion = document.createElement('option');
        opcion.value = modelo.id;
        opcion.textContent = modelo.name;
        $('model').append(opcion);
    }

    if (disponibles.some(m => m.id === preferido)) {
        $('model').value = preferido;
    }

    actualizarModeloSeleccionado();
}

function actualizarModeloSeleccionado() {
    const modelo = obtenerModelo($('model').value);
    if (!modelo) return;

    $('selected-model').textContent = modelo.name;
    $('model-description').textContent = modelo.description;
    $('model-name').textContent = modelo.name;
    $('model-provider').textContent = modelo.providerName;

    localStorage.setItem('agente:modelo', modelo.id);
}

function mostrarExplicacion(datos) {
    const contenedor = $('ai-explanation');
    contenedor.hidden = false;
    contenedor.replaceChildren();

    const titulo = document.createElement('strong');

    titulo.textContent = datos.verified
        ? '✦ Análisis completado'
        : '⚠ Revisión necesaria';

    titulo.style.color = datos.verified
        ? '#69ddb0'
        : '#f9c77b';

    const contenido = document.createElement('p');
    contenido.textContent =
        datos.explanation || 'Sin explicación disponible.';

    const detalle = document.createElement('small');
    detalle.textContent = datos.detail || '';

    contenedor.append(titulo, contenido, detalle);
}

$('provider').addEventListener('change', () => {
    configurarModelos();
});

$('model').addEventListener('change', () => {
    actualizarModeloSeleccionado();
});

$('start').addEventListener('click', async () => {
    const modeloId = $('model').value;

    if (!modeloId) {
        agregarLog('Selecciona un modelo primero.', 'warn');
        return;
    }

    $('start').disabled = true;

    try {
        const resultado = await window.agentAPI.start(modeloId);

        if (!resultado.ok) {
            agregarLog(resultado.error, 'error');
        }

        actualizarEstado(await window.agentAPI.status());
    } catch (error) {
        agregarLog(error.message, 'error');
        $('start').disabled = false;
    }
});

$('stop').addEventListener('click', async () => {
    $('stop').disabled = true;

    try {
        await window.agentAPI.stop();
    } catch (error) {
        agregarLog(error.message, 'error');
    }
});

$('clear').addEventListener('click', () => {
    $('logs').replaceChildren();
});

window.agentAPI.onEvent(({ event, payload }) => {
    if (event === 'status') {
        actualizarEstado(payload);
    }

    if (event === 'log') {
        agregarLog(
            payload.message,
            payload.level,
            payload.at
        );
    }

    if (event === 'question') {
        $('qnumber').textContent =
            `Pregunta ${payload.number}`;

        $('question').textContent = payload.text;

        $('answer').textContent = 'Analizando con IA...';
        $('answer').style.color = '#69ddb0';

        $('ai-explanation').hidden = true;
        $('ai-explanation').replaceChildren();

        $('options').replaceChildren();

        for (const opcion of payload.options) {
            const elemento = document.createElement('div');

            elemento.className = 'option';
            elemento.dataset.letter = opcion.letter;
            elemento.textContent =
                `${opcion.letter}. ${opcion.text}`;

            $('options').append(elemento);
        }
    }

    if (event === 'answer') {
        $('answer').textContent = payload.verified
            ? `Respuesta sugerida: ${payload.letter}. ${payload.text}`
            : `Revisar: ${payload.letter}. ${payload.text}`;

        $('answer').style.color = payload.verified
            ? '#69ddb0'
            : '#f9c77b';

        for (const elemento of $('options').children) {
            elemento.classList.toggle(
                'selected',
                elemento.dataset.letter === payload.letter
            );
        }

        mostrarExplicacion(payload);
    }
});

async function inicializar() {
    try {
        modelos = await window.agentAPI.models();

        configurarProveedor();

        const guardado = localStorage.getItem('agente:modelo');
        const modeloInicial =
            obtenerModelo(guardado) ||
            modelos[0];

        if (modeloInicial) {
            $('provider').value = modeloInicial.provider;
            configurarModelos(modeloInicial.id);
        }

        actualizarEstado(await window.agentAPI.status());

        agregarLog(
            `${modelos.length} modelos disponibles para seleccionar.`
        );
    } catch (error) {
        agregarLog(
            `No se pudieron cargar los modelos: ${error.message}`,
            'error'
        );
    }
}

inicializar();
