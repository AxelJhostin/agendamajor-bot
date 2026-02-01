const express = require("express")
const twilio = require("twilio")

const app = express()

// Twilio manda application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }))

// Estado en memoria (por número de WhatsApp)
const sessions = new Map()
// sessions.get(phone) = { state: "...", data: {...} }

app.get("/health", (req, res) => {
  res.status(200).send("ok")
})

app.post("/twilio/incoming", (req, res) => {
  const phone = req.body.From // "whatsapp:+593..."
  const body = (req.body.Body || "").trim()
  const normalized = body.toLowerCase()

  const twiml = new twilio.twiml.MessagingResponse()

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

  const helpText =
    `Puedes escribir:\n` +
    `- "menú" para ver opciones\n` +
    `- 1 a 6 para elegir\n` +
    `- 0 para ayuda\n\n` +
    `Escribe "menú" para empezar.`

  const goMenu = () => {
    sessions.set(phone, { state: "MENU", data: {} })
    return menu
  }

  // Comandos globales (funcionan desde cualquier estado)
  if (normalized === "menu" || normalized === "menú" || normalized === "inicio" || normalized === "hola") {
    twiml.message(goMenu())
    return res.type("text/xml").send(twiml.toString())
  }
  if (normalized === "0" || normalized === "ayuda") {
    twiml.message(helpText)
    return res.type("text/xml").send(twiml.toString())
  }

  // Cargar sesión
  const session = sessions.get(phone) || { state: "MENU", data: {} }

  let replyText = ""

  switch (session.state) {
    case "MENU": {
      if (normalized === "1") {
        sessions.set(phone, { state: "ADD_APPT_TITLE", data: {} })
        replyText = "Perfecto ✅\n¿Cuál es la cita? (Ej: Cardiólogo, Terapia, Laboratorio)"
        break
      }

      // Placeholder para opciones aún no implementadas
      if (["2", "3", "4", "5", "6"].includes(normalized)) {
        replyText =
          `Aún estoy aprendiendo esa opción 😊\n` +
          `Por ahora escribe 1 para agendar una cita o escribe "menú".`
        break
      }

      replyText =
        `No te entendí ⚠️\n` +
        `Responde con un número (1–6) o escribe "menú".`
      break
    }

    case "ADD_APPT_TITLE": {
      const title = body
      if (!title) {
        replyText = "Escribe el nombre de la cita, por favor. (Ej: Cardiólogo)"
        break
      }
      sessions.set(phone, { state: "ADD_APPT_DATE", data: { title } })
      replyText = `Anotado ✅: ${title}\n\nAhora dime el día (DD/MM). Ej: 05/02`
      break
    }

    case "ADD_APPT_DATE": {
      // Validación simple DD/MM
      const m = body.match(/^(\d{1,2})\/(\d{1,2})$/)
      if (!m) {
        replyText = "Fecha no válida ⚠️\nEscribe en formato DD/MM. Ej: 05/02"
        break
      }
      const dd = Number(m[1])
      const mm = Number(m[2])
      if (dd < 1 || dd > 31 || mm < 1 || mm > 12) {
        replyText = "Fecha no válida ⚠️\nEjemplo correcto: 05/02"
        break
      }

      const data = session.data
      sessions.set(phone, { state: "ADD_APPT_TIME", data: { ...data, date: body } })
      replyText = `Perfecto ✅ Día: ${body}\n\nAhora dime la hora (HH:MM). Ej: 16:30`
      break
    }

    case "ADD_APPT_TIME": {
      // Validación HH:MM 24h
      const m = body.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
      if (!m) {
        replyText = "Hora no válida ⚠️\nEscribe en formato HH:MM. Ej: 16:30"
        break
      }

      const data = session.data
      sessions.set(phone, { state: "ADD_APPT_CONFIRM", data: { ...data, time: body } })

      replyText =
        `CONFIRMA ✅\n` +
        `Cita: ${data.title}\n` +
        `Día: ${data.date}\n` +
        `Hora: ${body}\n\n` +
        `1) Confirmar\n` +
        `2) Cambiar\n` +
        `0) Menú`
      break
    }

    case "ADD_APPT_CONFIRM": {
      if (normalized === "1") {
        // Guardado “en memoria” (por ahora solo confirmamos)
        sessions.set(phone, { state: "MENU", data: {} })
        replyText = `Listo ✅ Guardé tu cita.\n\nEscribe "menú" para ver opciones.`
        break
      }
      if (normalized === "2") {
        const prev = session.data
        sessions.set(phone, { state: "ADD_APPT_DATE", data: { title: prev.title } })
        replyText = `De acuerdo 👍\nRepite el día (DD/MM). Ej: 05/02`
        break
      }
      replyText = `Responde 1 para confirmar, 2 para cambiar, o 0 para menú.`
      break
    }

    default: {
      replyText = goMenu()
      break
    }
  }

  twiml.message(replyText)
  res.type("text/xml").send(twiml.toString())
})

const PORT = process.env.PORT || 8080
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`)
})
