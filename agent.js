
require('dotenv').config();

const { chromium } = require('playwright');

const CONFIG = {
    url: 'https://virtual3.itca.edu.sv/',
    intervalo: 1500,
    timeout: 120000,
    seleccionarAutomaticamente: true
};

// ==========================================
// MODELOS DISPONIBLES
// ==========================================

const MODELOS = [
    {
        id: 'groq-gpt-oss',
        name: 'GPT-OSS 120B',
        provider: 'groq',
        providerName: 'GroqCloud',
        model: 'openai/gpt-oss-120b',
        description: 'Modelo de razonamiento avanzado.',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        env: 'GROQ_API_KEY'
    },
    {
        id: 'zen-nemotron-ultra',
        name: 'Nemotron 3 Ultra Free',
        provider: 'zen',
        providerName: 'OpenCode Zen',
        model: 'nemotron-3-ultra-free',
        description: 'Modelo gratuito de razonamiento.',
        endpoint: 'https://opencode.ai/zen/v1/chat/completions',
        env: 'OPENCODE_API_KEY'
    },
    {
        id: 'zen-nemotron-lightning',
        name: 'Nemotron 3.5 Lightning Free',
        provider: 'zen',
        providerName: 'OpenCode Zen',
        model: 'nemotron-3.5-lightning-free',
        description: 'Modelo gratuito y rápido.',
        endpoint: 'https://opencode.ai/zen/v1/chat/completions',
        env: 'OPENCODE_API_KEY'
    },
    {
        id: 'zen-mimo',
        name: 'MiMo-V2.6-Flash Free',
        provider: 'zen',
        providerName: 'OpenCode Zen',
        model: 'mimo-v2.6-flash-free',
        description: 'Alternativa gratuita de IA.',
        endpoint: 'https://opencode.ai/zen/v1/chat/completions',
        env: 'OPENCODE_API_KEY'
    },
    {
        id: 'zen-ling',
        name: 'Ling 3.1 Flash Free',
        provider: 'zen',
        providerName: 'OpenCode Zen',
        model: 'ling-3.1-flash-free',
        description: 'Modelo gratuito de OpenCode Zen.',
        endpoint: 'https://opencode.ai/zen/v1/chat/completions',
        env: 'OPENCODE_API_KEY'
    },
    {
        id: 'zen-space-bunny',
        name: 'Space Bunny Free',
        provider: 'zen',
        providerName: 'OpenCode Zen',
        model: 'space-bunny-free',
        description: 'Modelo gratuito de OpenCode.',
        endpoint: 'https://opencode.ai/zen/v1/chat/completions',
        env: 'OPENCODE_API_KEY'
    },
    {
        id: 'openrouter-free',
        name: 'Free Models Router',
        provider: 'openrouter',
        providerName: 'OpenRouter',
        model: 'openrouter/free',
        description: 'Selecciona un modelo gratuito disponible.',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        env: 'OPENROUTER_API_KEY'
    }
];

const esperar = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// AGENTE PRINCIPAL
// ==========================================

class Agent {
    constructor(emitir) {
        this.emitir = emitir;
        this.running = false;
        this.starting = false;
        this.contexto = null;
        this.perfil = null;
        this.modeloActual = null;
        this.procesadas = new Set();
        this.controller = null;
    }

    models() {
        return MODELOS.map(modelo => ({
            id: modelo.id,
            name: modelo.name,
            provider: modelo.provider,
            providerName: modelo.providerName,
            description: modelo.description
        }));
    }

    setProfileDir(directorio) {
        this.perfil = directorio;
    }

    status() {
        return {
            running: this.running,
            starting: this.starting,
            model: this.modeloActual?.id || null
        };
    }

    log(mensaje, nivel = 'info') {
        this.emitir('log', {
            message: mensaje,
            level: nivel,
            at: new Date().toLocaleTimeString()
        });
    }

    // ==========================================
    // INICIAR AGENTE
    // ==========================================

    async start(modeloId) {
        if (this.running || this.starting) {
            return {
                ok: false,
                error: 'El agente ya está iniciado.'
            };
        }

        const modelo = MODELOS.find(
            item => item.id === modeloId
        );

        if (!modelo) {
            return {
                ok: false,
                error: 'Selecciona un modelo válido.'
            };
        }

        if (!process.env[modelo.env]) {
            return {
                ok: false,
                error: `Falta ${modelo.env} en el archivo .env.`
            };
        }

        this.modeloActual = modelo;
        this.running = true;
        this.starting = true;
        this.procesadas.clear();

        this.emitir('status', this.status());

        this.ejecutar()
            .catch(error => {
                if (this.running) {
                    this.log(error.message, 'error');
                }
            })
            .finally(async () => {
                this.running = false;
                this.starting = false;
                this.controller?.abort();

                const contexto = this.contexto;
                this.contexto = null;

                if (contexto) {
                    try {
                        await contexto.close();
                    } catch {}
                }

                this.emitir('status', this.status());
                this.log('Agente detenido.');
            });

        return { ok: true };
    }

    // ==========================================
    // DETENER AGENTE
    // ==========================================

    async stop() {
        this.running = false;
        this.controller?.abort();

        this.log('Deteniendo agente...');

        if (this.contexto) {
            try {
                await this.contexto.close();
            } catch {}
        }

        return { ok: true };
    }

    // ==========================================
    // EXTRAER PREGUNTA DE MOODLE
    // ==========================================

    async obtenerPregunta(pagina) {
        try {
            return await pagina.evaluate(() => {
                const contenedor = document.querySelector('.que');

                if (!contenedor) return null;

                const enunciado = contenedor
                    .querySelector('.qtext')
                    ?.innerText.trim();

                if (!enunciado) return null;

                const radios = [
                    ...contenedor.querySelectorAll(
                        '.answer input[type="radio"]'
                    )
                ];

                const opciones = radios.map((input, indice) => {
                    const etiqueta = input.id
                        ? [...contenedor.querySelectorAll('label')]
                            .find(label => label.htmlFor === input.id)
                        : null;

                    const texto = (
                        etiqueta?.innerText ||
                        input.closest(
                            '.r0, .r1, .r2, .r3, .r4, .r5'
                        )?.innerText ||
                        input.parentElement?.innerText ||
                        ''
                    )
                        .trim()
                        .replace(/^[a-z]\.\s*/i, '')
                        .trim();

                    return {
                        letra: String.fromCharCode(65 + indice),
                        texto,
                        id: input.id,
                        valor: input.value,
                        indice
                    };
                }).filter(opcion => opcion.texto);

                return {
                    id: contenedor.id,
                    numero: contenedor
                        .querySelector('.qno')
                        ?.innerText.trim() || '?',
                    enunciado,
                    opciones
                };
            });
        } catch (error) {
            if (
                /navigation|Execution context was destroyed|Target closed/i
                    .test(error.message)
            ) {
                return null;
            }

            throw error;
        }
    }

    // ==========================================
    // DETECTAR VERDADERO / FALSO
    // ==========================================

    esVerdaderoFalso(pregunta) {
        if (pregunta.opciones.length !== 2) {
            return false;
        }

        const textos = pregunta.opciones.map(
            opcion => opcion.texto.trim().toLowerCase()
        );

        return (
            textos.includes('verdadero') &&
            textos.includes('falso')
        );
    }

    // ==========================================
    // CONSTRUIR PROMPT
    // ==========================================

    construirPrompt(pregunta) {
        const opciones = pregunta.opciones
            .map(opcion =>
                `${opcion.letra}. ${opcion.texto}`
            )
            .join('\n');

        const tipo = this.esVerdaderoFalso(pregunta)
            ? 'VERDADERO O FALSO'
            : 'SELECCIÓN MÚLTIPLE';

        return `
Eres un asistente académico especializado
en analizar preguntas educativas.

TIPO DE PREGUNTA: ${tipo}

INSTRUCCIONES:

1. Lee cuidadosamente el enunciado.

2. Analiza todas las opciones antes de elegir.

3. Si es verdadero/falso, evalúa si la
   afirmación completa es correcta.

4. Si aparece un título seguido de una lista,
   interpreta que se afirma que los elementos
   pertenecen a la categoría indicada.

5. Comprueba individualmente los elementos
   de una lista.

6. Considera negaciones, fechas, excepciones
   y afirmaciones absolutas.

7. Si el enunciado contiene fechas históricas,
   presta especial atención al período indicado.

8. No inventes datos ni fuentes.

9. Si existe ambigüedad importante,
   indícalo.

10. Explica brevemente tu elección.

PREGUNTA:
${pregunta.enunciado}

OPCIONES:
${opciones}

Devuelve preferentemente este JSON:

{
    "respuesta": "LETRA",
    "explicacion": "Justificación breve en español",
    "ambigua": false
}

La respuesta debe ser una letra de las opciones.

No escribas texto fuera del JSON.
`;
    }

    // ==========================================
    // EXTRAER JSON DE LA RESPUESTA
    // ==========================================

    extraerJSON(contenido) {
        if (typeof contenido !== 'string') {
            throw new Error(
                'La IA devolvió un contenido inválido.'
            );
        }

        let texto = contenido.trim();

        texto = texto
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, '')
            .trim();

        try {
            return JSON.parse(texto);
        } catch {
            const inicio = texto.indexOf('{');
            const final = texto.lastIndexOf('}');

            if (inicio >= 0 && final > inicio) {
                try {
                    return JSON.parse(
                        texto.slice(inicio, final + 1)
                    );
                } catch {}
            }

            const coincidencia = texto.match(
                /(?:respuesta|opci[oó]n|answer)\s*[:=\-]?\s*["']?([A-Z])\b/i
            );

            if (coincidencia) {
                return {
                    respuesta: coincidencia[1],
                    explicacion: '',
                    ambigua: true
                };
            }

            throw new Error(
                'No se pudo interpretar la respuesta de la IA.'
            );
        }
    }

    // ==========================================
    // NORMALIZAR RESPUESTA
    // ==========================================

    normalizarRespuesta(resultado, pregunta, modelo) {
        if (!resultado || typeof resultado !== 'object') {
            throw new Error(
                'El modelo devolvió una respuesta inválida.'
            );
        }

        const respuestaOriginal = String(
            resultado.respuesta ??
            resultado.opcion ??
            resultado.answer ??
            resultado.choice ??
            ''
        ).trim();

        let letra = respuestaOriginal.toUpperCase();

        const coincidenciaLetra = letra.match(
            /^([A-Z])(?:[.)\s:-]|$)/
        );

        if (coincidenciaLetra) {
            letra = coincidenciaLetra[1];
        }

        const coincidenciaNumero = respuestaOriginal.match(
            /^(?:opci[oó]n\s*)?(\d+)$/i
        );

        if (coincidenciaNumero) {
            const indice = Number(
                coincidenciaNumero[1]
            ) - 1;

            if (pregunta.opciones[indice]) {
                letra = pregunta.opciones[indice].letra;
            }
        }

        let opcion = pregunta.opciones.find(
            item => item.letra === letra
        );

        if (!opcion) {
            const normalizarTexto = texto =>
                String(texto)
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();

            const textoBuscado = normalizarTexto(
                respuestaOriginal
            );

            opcion = pregunta.opciones.find(
                item => normalizarTexto(item.texto) ===
                    textoBuscado
            );
        }

        if (!opcion) {
            throw new Error(
                `El modelo devolvió una opción no reconocida: ` +
                respuestaOriginal.slice(0, 80)
            );
        }

        const explicacionOriginal =
            resultado.explicacion ??
            resultado.justificacion ??
            resultado.reason ??
            resultado.explanation;

        const explicacion = typeof explicacionOriginal === 'string'
            ? explicacionOriginal.trim()
            : '';

        const ambiguedadOriginal =
            resultado.ambigua ??
            resultado.ambiguo ??
            resultado.uncertain;

        const ambigua =
            ambiguedadOriginal === true ||
            ambiguedadOriginal === 'true' ||
            ambiguedadOriginal === 1;

        const camposCompletos =
            explicacion.length > 0 &&
            typeof ambiguedadOriginal === 'boolean';

        return {
            ...opcion,
            explicacion: explicacion ||
                'El modelo no proporcionó una explicación.',
            verificada: camposCompletos && !ambigua,
            detalle: !camposCompletos
                ? 'El modelo devolvió información incompleta. Revisa la respuesta.'
                : ambigua
                    ? 'El modelo detectó ambigüedad.'
                    : `Analizado por ${modelo.name}. ` +
                      'No se ha contrastado con otra fuente.'
        };
    }

    // ==========================================
    // CONSULTAR MODELO
    // ==========================================

    async consultarModelo(pregunta) {
        const modelo = this.modeloActual;

        if (!modelo) {
            throw new Error('No hay un modelo seleccionado.');
        }

        const controller = new AbortController();
        this.controller = controller;

        const temporizador = setTimeout(
            () => controller.abort(),
            CONFIG.timeout
        );

        const cuerpo = {
            model: modelo.model,
            messages: [
                {
                    role: 'user',
                    content: this.construirPrompt(pregunta)
                }
            ],
            stream: false,
            max_tokens: 1800
        };

        if (modelo.provider === 'groq') {
            delete cuerpo.max_tokens;

            cuerpo.max_completion_tokens = 2048;
            cuerpo.reasoning_effort = 'high';
            cuerpo.reasoning_format = 'hidden';

            cuerpo.response_format = {
                type: 'json_schema',
                json_schema: {
                    name: 'respuesta_academica',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: {
                            respuesta: {
                                type: 'string',
                                enum: pregunta.opciones.map(
                                    opcion => opcion.letra
                                )
                            },
                            explicacion: {
                                type: 'string'
                            },
                            ambigua: {
                                type: 'boolean'
                            }
                        },
                        required: [
                            'respuesta',
                            'explicacion',
                            'ambigua'
                        ],
                        additionalProperties: false
                    }
                }
            };
        }

        try {
            this.log(`Consultando ${modelo.name}...`);

            const respuesta = await fetch(modelo.endpoint, {
                method: 'POST',
                headers: {
                    Authorization:
                        `Bearer ${process.env[modelo.env]}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(cuerpo),
                signal: controller.signal
            });

            if (!respuesta.ok) {
                if (
                    respuesta.status === 401 ||
                    respuesta.status === 403
                ) {
                    throw new Error(
                        `Clave API inválida o acceso denegado ` +
                        `para ${modelo.name}.`
                    );
                }

                if (respuesta.status === 429) {
                    throw new Error(
                        `Se alcanzó el límite de solicitudes ` +
                        `de ${modelo.providerName}.`
                    );
                }

                if (respuesta.status === 402) {
                    throw new Error(
                        'El proveedor requiere saldo o facturación.'
                    );
                }

                throw new Error(
                    `${modelo.providerName} devolvió ` +
                    `HTTP ${respuesta.status}.`
                );
            }

            const datos = await respuesta.json();
            const mensaje = datos.choices?.[0]?.message;

            let contenido = mensaje?.content;

            if (Array.isArray(contenido)) {
                contenido = contenido
                    .filter(parte => parte.type === 'text')
                    .map(parte => parte.text || '')
                    .join('\n');
            }

            if (
                typeof contenido !== 'string' ||
                !contenido.trim()
            ) {
                throw new Error(
                    'El modelo devolvió una respuesta vacía.'
                );
            }

            const resultado = this.extraerJSON(contenido);

            const normalizada = this.normalizarRespuesta(
                resultado,
                pregunta,
                modelo
            );

            this.log(
                `Respuesta recibida de ${modelo.name}.`
            );

            return normalizada;
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error(
                    this.running
                        ? 'La consulta superó el tiempo de espera.'
                        : 'Consulta cancelada.'
                );
            }

            throw error;
        } finally {
            clearTimeout(temporizador);

            if (this.controller === controller) {
                this.controller = null;
            }
        }
    }

    // ==========================================
    // COMPROBAR PREGUNTA ACTUAL
    // ==========================================

    async preguntaSigueIgual(pagina, pregunta) {
        if (!this.running || pagina.isClosed()) {
            return false;
        }

        if (
            !pagina.url().includes(
                '/mod/quiz/attempt.php'
            )
        ) {
            return false;
        }

        const actual = await this.obtenerPregunta(pagina);

        if (!actual) return false;

        return (
            actual.id === pregunta.id &&
            actual.enunciado === pregunta.enunciado &&
            JSON.stringify(actual.opciones) ===
                JSON.stringify(pregunta.opciones)
        );
    }

    // ==========================================
    // SELECCIONAR RESPUESTA AUTOMÁTICAMENTE
    // ==========================================

    async seleccionarRespuesta(pagina, pregunta, respuesta) {
        if (!CONFIG.seleccionarAutomaticamente) {
            return false;
        }

        if (!respuesta.verificada) {
            this.log(
                'No se marcó automáticamente: ' +
                'la respuesta necesita revisión.',
                'warn'
            );

            return false;
        }

        if (
            !(await this.preguntaSigueIgual(
                pagina,
                pregunta
            ))
        ) {
            this.log(
                'No se marcó: la pregunta cambió.',
                'warn'
            );

            return false;
        }

        // Usar el índice original del radio,
        // incluso si hubo opciones vacías.
        const indice = respuesta.indice;

        if (!Number.isInteger(indice) || indice < 0) {
            return false;
        }

        try {
            const radio = pagina
                .locator('.que')
                .first()
                .locator('.answer input[type="radio"]')
                .nth(indice);

            await radio.check({ timeout: 5000 });

            const seleccionado = await radio.isChecked();

            if (!seleccionado) {
                throw new Error(
                    'El radio no quedó seleccionado.'
                );
            }

            this.log(
                `Respuesta marcada en Moodle: ` +
                `${respuesta.letra}. ${respuesta.texto}`
            );

            return true;
        } catch (error) {
            this.log(
                `No se pudo marcar la respuesta: ${error.message}`,
                'warn'
            );

            return false;
        }
    }

    // ==========================================
    // EJECUTAR AGENTE
    // ==========================================

    async ejecutar() {
        this.log('Abriendo Google Chrome...');

        this.contexto = await chromium.launchPersistentContext(
            this.perfil,
            {
                headless: false,
                channel: 'chrome',
                viewport: null
            }
        );

        const pagina = this.contexto.pages()[0] ||
            await this.contexto.newPage();

        await pagina.goto(CONFIG.url);

        if (!this.running) return;

        this.starting = false;
        this.emitir('status', this.status());

        this.log('Navegador iniciado correctamente.');
        this.log(
            `Modelo seleccionado: ${this.modeloActual.name}`
        );
        this.log('Abre tu cuestionario para comenzar.');
        this.log(
            'La selección de respuestas es automática. ' +
            'El avance y envío son manuales.'
        );

        while (this.running && !pagina.isClosed()) {
            try {
                if (
                    !pagina.url().includes(
                        '/mod/quiz/attempt.php'
                    )
                ) {
                    await esperar(CONFIG.intervalo);
                    continue;
                }

                const pregunta =
                    await this.obtenerPregunta(pagina);

                if (
                    !pregunta ||
                    !pregunta.opciones.length
                ) {
                    await esperar(CONFIG.intervalo);
                    continue;
                }

                const clave = JSON.stringify([
                    pagina.url(),
                    pregunta.id,
                    pregunta.numero,
                    pregunta.enunciado,
                    pregunta.opciones
                ]);

                if (this.procesadas.has(clave)) {
                    await esperar(CONFIG.intervalo);
                    continue;
                }

                this.procesadas.add(clave);

                this.emitir('question', {
                    number: pregunta.numero,
                    text: pregunta.enunciado,
                    options: pregunta.opciones.map(opcion => ({
                        letter: opcion.letra,
                        text: opcion.texto
                    }))
                });

                this.log(
                    `Pregunta ${pregunta.numero}: ` +
                    'iniciando análisis...'
                );

                let respuesta;

                try {
                    respuesta = await this.consultarModelo(
                        pregunta
                    );
                } catch (error) {
                    if (this.running) {
                        this.log(
                            `Error: ${error.message}`,
                            'error'
                        );
                    }

                    continue;
                }

                if (!this.running) break;

                if (
                    !(await this.preguntaSigueIgual(
                        pagina,
                        pregunta
                    ))
                ) {
                    this.log(
                        'La pregunta cambió durante el análisis.',
                        'warn'
                    );

                    continue;
                }

                this.emitir('answer', {
                    number: pregunta.numero,
                    letter: respuesta.letra,
                    text: respuesta.texto,
                    explanation: respuesta.explicacion,
                    verified: respuesta.verificada,
                    detail: respuesta.detalle
                });

                this.log(
                    `Sugerencia: ${respuesta.letra}. ` +
                    respuesta.texto
                );

                if (!respuesta.verificada) {
                    this.log(
                        'La respuesta requiere revisión manual.',
                        'warn'
                    );
                }

                await this.seleccionarRespuesta(
                    pagina,
                    pregunta,
                    respuesta
                );

                this.log(
                    'Esperando que cambies de pregunta...'
                );
            } catch (error) {
                if (this.running) {
                    this.log(error.message, 'error');
                }
            }

            await esperar(CONFIG.intervalo);
        }
    }
}

module.exports = { Agent };
