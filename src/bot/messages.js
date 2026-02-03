//src/bot/messages.js
function buildMenu() {
  return (
    `Hola 👋 Soy AgendaMayor.\n` +
    `Te ayudo con tus citas y medicinas.\n\n` +
    `Responde con un número:\n` +
    `1) Agendar cita\n` +
    `2) Agendar medicina\n` +
    `3) Ver lo de hoy\n` +
    `4) Ver próximos 7 días\n` +
    `5) PDF semanal para imprimir\n` +
    `6) Configurar contacto de apoyo\n` +
    `0) Ayuda / menú\n\n` +
    `Tip: escribe "cancelar" si te equivocaste.`
  )
}

function buildHelp() {
  return (
    `Puedes escribir:\n` +
    `- "menú" para ver opciones\n` +
    `- 1 a 6 para elegir\n` +
    `- 0 para ayuda\n` +
    `- "cancelar" para cancelar lo que estabas haciendo\n\n` +
    `Escribe "menú" para empezar.`
  )
}

module.exports = { buildMenu, buildHelp }
