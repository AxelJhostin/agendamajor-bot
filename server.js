const express = require("express")
const twilio = require("twilio")

const app = express()

// Twilio manda application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }))

app.get("/health", (req, res) => {
  res.status(200).send("ok")
})

app.post("/twilio/incoming", (req, res) => {
  const from = req.body.From
  const body = (req.body.Body || "").trim()

  const twiml = new twilio.twiml.MessagingResponse()
  const normalized = body.toLowerCase()

    const menu =
    `Hola 👋 Soy AgendaMayor.\n` +
    `Te ayudo con tus citas y medicinas.\n\n` +
    `Responde con un número:\n` +
    `1) Agendar cita\n` +
    `2) Agendar medicina\n` +
    `3) Ver lo de hoy\n` +
    `4) Ver mi semana\n` +
    `5) PDF semanal para imprimir\n` +
    `6) Configurar contacto de apoyo\n` +
    `0) Ayuda / menú`

    let replyText = ""

    if (
    normalized === "menu" ||
    normalized === "menú" ||
    normalized === "inicio" ||
    normalized === "hola" ||
    normalized === "1"
    ) {
    replyText = menu
    } else if (normalized === "0" || normalized === "ayuda") {
    replyText =
        `Puedes escribir:\n` +
        `- "menú" para ver opciones\n` +
        `- 1 a 6 para elegir\n` +
        `- 0 para ayuda\n\n` +
        `Escribe "menú" para empezar.`
    } else {
    replyText =
        `No te entendí ⚠️\n` +
        `Por favor responde con un número (1–6) o escribe "menú".\n\n` +
        `Escribe "menú" para ver opciones.`
    }

    twiml.message(replyText)


  res.type("text/xml").send(twiml.toString())
})

const PORT = process.env.PORT || 8080
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`)
})
