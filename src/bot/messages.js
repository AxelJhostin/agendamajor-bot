//src/bot/messages.js
function buildMenu() {
  return (
    `Hola \uD83D\uDC4B Soy AgendaMayor.\n` +
    `Estoy aqu\u00ed para ayudarte con tus citas y medicinas.\n\n` +
    `Responde con un n\u00famero:\n` +
    `1) Agendar cita\n` +
    `2) Agendar medicina\n` +
    `3) Ver lo de hoy\n` +
    `4) Ver pr\u00f3ximos 7 d\u00edas\n` +
    `5) PDF semanal para imprimir\n` +
    `6) Contacto de apoyo\n` +
    `0) Ayuda / men\u00fa\n\n` +
    `Tip: si te equivocas, escribe "cancelar".`
  )
}

function buildHelp() {
  return (
    `Ayuda r\u00e1pida \u2705\n` +
    `- Escribe "men\u00fa" para ver opciones.\n` +
    `- Responde 1 a 6 para elegir.\n` +
    `- 0 para ver ayuda.\n` +
    `- "cancelar" para volver al men\u00fa.\n\n` +
    `Ejemplos: 1 (cita), 2 (medicina), 5 (PDF).\n\n` +
    `Estoy aqu\u00ed para ayudarte. Escribe "men\u00fa" para empezar.`
  )
}

module.exports = { buildMenu, buildHelp }
