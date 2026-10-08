
require('dotenv').config();

const { chromium } = require('playwright');

const CONFIG = {
    url: 'https://virtual3.itca.edu.sv/',
    modeloOllama: 'qwen3:4b',
    urlOllama: 'http://127.0.0.1:11434/api/generate',
    intervalo: 1500,
    timeoutOllama: 180000,
    maxTokens: 100,
    contexto: 2048
};

const procesadas = new Set();

const esperar = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// CONSULTAR OLLAMA
// ==========================================

async function consultarOllama(pregunta) {
    console.log('\nConsultando Ollama local...');
    console.time('Tiempo Ollama');

    const letras = pregunta.opciones.map(opcion => opcion.letra);

    const opcionesTexto = pregunta.opciones
        .map(opcion => `${opcion.letra}. ${opcion.texto}`)
        .join('\n');

    const prompt = `/no_think

Selecciona la opción que consideras correcta.

PREGUNTA:
${pregunta.enunciado}

OPCIONES:
${opcionesTexto}

Devuelve únicamente la letra elegida en el
campo "respuesta" del JSON solicitado.

No incluyas explicaciones ni razonamiento.`;

    try {
        const respuesta = await fetch(CONFIG.urlOllama, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: CONFIG.modeloOllama,

                system: [
                    'Eres un asistente académico.',
                    'Selecciona una sola opción.',
                    'No generes explicaciones.',
                    'No muestres razonamiento interno.',
                    'Respeta el formato JSON solicitado.'
                ].join(' '),

                prompt,
                stream: false,
                think: false,

                format: {
                    type: 'object',
                    properties: {
                        respuesta: {
                            type: 'string',
                            enum: letras
                        }
                    },
                    required: ['respuesta'],
                    additionalProperties: false
                },

                options: {
                    num_predict: CONFIG.maxTokens,
                    temperature: 0,
                    num_ctx: CONFIG.contexto
                }
            }),
            signal: AbortSignal.timeout(
                CONFIG.timeoutOllama
            )
        });

        if (!respuesta.ok) {
            const detalle = await respuesta.text();

            throw new Error(
                `Ollama HTTP ${respuesta.status}: ${detalle}`
            );
        }

        const datos = await respuesta.json();

        if (!datos.response?.trim()) {
            throw new Error(
                'Ollama devolvió una respuesta vacía.'
            );
        }

        let resultado;

        try {
            resultado = JSON.parse(datos.response);
        } catch {
            throw new Error(
                'Ollama no devolvió un JSON válido.'
            );
        }

        const letra = String(resultado.respuesta || '')
            .trim()
            .toUpperCase();

        const opcion = pregunta.opciones.find(
            item => item.letra === letra
        );

        if (!opcion) {
            throw new Error(
                'Ollama devolvió una opción inexistente.'
            );
        }

        return opcion;

    } catch (error) {
        if (
            error.name === 'TimeoutError' ||
            error.name === 'AbortError'
        ) {
            throw new Error(
                'Ollama superó los 180 segundos de espera.'
            );
        }

        throw error;

    } finally {
        console.timeEnd('Tiempo Ollama');
    }
}

// ==========================================
// EXTRAER PREGUNTA DE MOODLE
// ==========================================

async function obtenerPregunta(pagina) {
    try {
        return await pagina.evaluate(() => {
            const contenedor = document.querySelector('.que');

            if (!contenedor) return null;

            const enunciado = contenedor
                .querySelector('.qtext')
                ?.innerText.trim();

            if (!enunciado) return null;

            const numero = contenedor
                .querySelector('.qno')
                ?.innerText.trim() || '?';

            const entradas = [
                ...contenedor.querySelectorAll(
                    'input[type="radio"]'
                )
            ];

            const opciones = entradas.map((input, indice) => {
                let label = null;

                if (input.id) {
                    label = [
                        ...contenedor.querySelectorAll('label')
                    ].find(elemento =>
                        elemento.htmlFor === input.id
                    );
                }

                const texto = (
                    label?.innerText ||
                    input.closest(
                        '.r0, .r1, .r2, .r3, .r4, .r5'
                    )?.innerText ||
                    input.parentElement?.innerText ||
                    ''
                ).trim();

                return {
                    letra: String.fromCharCode(65 + indice),
                    texto: texto
                        .replace(/^[a-z]\.\s*/i, '')
                        .trim()
                };
            }).filter(opcion => opcion.texto);

            return {
                id: contenedor.id,
                numero,
                enunciado,
                opciones
            };
        });

    } catch (error) {
        if (
            error.message.includes(
                'Execution context was destroyed'
            ) ||
            error.message.includes('navigation')
        ) {
            return null;
        }

        throw error;
    }
}

// ==========================================
// SELECCIONAR RESPUESTA AUTOMÁTICAMENTE
// ==========================================

async function seleccionarRespuesta(
    pagina,
    pregunta,
    opcion
) {
    try {
        const actual = await obtenerPregunta(pagina);

        if (
            !actual ||
            actual.id !== pregunta.id ||
            actual.enunciado !== pregunta.enunciado
        ) {
            console.log(
                'La pregunta cambió. Selección cancelada.'
            );

            return false;
        }

        const indice = pregunta.opciones.findIndex(
            item => item.letra === opcion.letra
        );

        if (indice === -1) {
            console.log('No se encontró la opción.');
            return false;
        }

        const contenedor = pagina.locator(
            `.que[id="${pregunta.id}"]`
        );

        const radio = contenedor
            .locator('input[type="radio"]')
            .nth(indice);

        await radio.check({
            timeout: 3000
        });

        console.log(
            `✓ Respuesta seleccionada: ${opcion.letra}. ${opcion.texto}`
        );

        return true;

    } catch (error) {
        console.error(
            'No se pudo seleccionar la respuesta:',
            error.message
        );

        return false;
    }
}

// ==========================================
// INICIAR AGENTE
// ==========================================

async function iniciar() {
    const contexto = await chromium.launchPersistentContext(
        './perfil-chrome',
        {
            headless: false,
            channel: 'chrome',
            viewport: null
        }
    );

    const pagina = contexto.pages()[0] ||
        await contexto.newPage();

    await pagina.goto(CONFIG.url);

    console.log('\n====================================');
    console.log('       AGENTE EDUCATIVO MOODLE');
    console.log('           OLLAMA LOCAL');
    console.log('====================================');

    console.log(`Modelo: ${CONFIG.modeloOllama}`);
    console.log('Inicia sesión y abre tu cuestionario.');
    console.log('El agente selecciona la respuesta.');
    console.log('Tú controlas el avance y el envío.');
    console.log('Para detener el agente: Ctrl + C\n');

    while (!pagina.isClosed()) {
        try {
            if (
                !pagina.url().includes('/mod/quiz/attempt.php')
            ) {
                await esperar(CONFIG.intervalo);
                continue;
            }

            const pregunta = await obtenerPregunta(pagina);

            if (!pregunta) {
                await esperar(CONFIG.intervalo);
                continue;
            }

            const clave = JSON.stringify({
                id: pregunta.id,
                numero: pregunta.numero,
                enunciado: pregunta.enunciado,
                opciones: pregunta.opciones
            });

            if (procesadas.has(clave)) {
                await esperar(CONFIG.intervalo);
                continue;
            }

            if (!pregunta.opciones.length) {
                console.log(
                    `Pregunta ${pregunta.numero}: esperando opciones...`
                );

                await esperar(CONFIG.intervalo);
                continue;
            }

            procesadas.add(clave);

            console.log('\n====================================');
            console.log(`PREGUNTA ${pregunta.numero}`);
            console.log('====================================');

            console.log(pregunta.enunciado);
            console.log('\nOPCIONES:');

            pregunta.opciones.forEach(opcion => {
                console.log(
                    `${opcion.letra}. ${opcion.texto}`
                );
            });

            try {
                const respuesta = await consultarOllama(
                    pregunta
                );

                console.log('\n====================================');
                console.log('        RESPUESTA DE OLLAMA');
                console.log('====================================');

                console.log(
                    `${respuesta.letra}. ${respuesta.texto}`
                );

                await seleccionarRespuesta(
                    pagina,
                    pregunta,
                    respuesta
                );

            } catch (error) {
                console.error(
                    '\nError de Ollama:',
                    error.message
                );
            }

            console.log(
                '\nEsperando que cambies de pregunta...\n'
            );

        } catch (error) {
            console.error(
                'Error del agente:',
                error.message
            );
        }

        await esperar(CONFIG.intervalo);
    }

    console.log(
        '\nNavegador cerrado. Agente detenido.'
    );
}

iniciar().catch(error => {
    console.error(
        'Error al iniciar:',
        error.message
    );
});
