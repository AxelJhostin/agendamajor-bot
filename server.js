const express = require("express")
const twilio = require("twilio")
const dayjs = require("dayjs")
const { ensureDb } = require("./db")

const app = express()
app.use(express.urlencoded({ extended: false }))

// DB
const db = ensureDb()

// Estado en memoria (por número de WhatsApp)
const sessions = new Map()

app.get("/health", (req, res) => {
  res.status(200).send("ok")
})

// Helpers de fechas
function parseDDMMToISO(ddmm) {
  const m = ddmm.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (!m) return null
  const dd = Number(m[1])
  const mm = Number(m[2])
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null
  // Año actual (suficiente para demo/examen)
  const year = dayjs().year()
  const iso = dayjs(`${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`)
  if (!iso.isValid()) return null
  return iso.format("YYYY-MM-DD")
}

function isValidTimeHHMM(hhmm) {
  return /^([01]?\d|2[0-3]):([0-5]\d)$/.test(hhmm)
}

function formatDateISOToDDMM(iso) {
  const d = dayjs(iso)
  if (!d.isValid()) return iso
  return d.format("DD/MM")
}

function getWeekRangeISO() {
  // Semana lunes-domingo
  const now = dayjs()
  const dow = now.day() // 0 domingo ... 6 sábado
  const monday = now.subtract((dow + 6) % 7, "day").startOf("day")
  const sunday = monday.add(6, "day").startOf("day")
  return { start: monday.format("YYYY-MM-DD"), end: sunday.format("YYYY-MM-DD") }
}

function groupByDate(items) {
  const map = new Map()
  for (const it of items) {
    if (!map.has(it.date)) map.set(it.date, [])
    map.get(it.date).push(it)
  }
  // ordenar por fecha
  const dates = Array.from(map.keys()).sort()
  return dates.map((date) => ({
    date,
    items: map.get(date).sort((a, b) => a.time.localeCompare(b.time))
  }))
}

// DB ops
const insertReminderStmt = db.prepare(`
  INSERT INTO reminders (phone, type, title, date, time, frequency, created_at)
  VALUES (@phone, @type, @title, @date, @time, @frequency, @created_at)
`)

const selectTodayStmt = db.prepare(`
  SELECT id, type, title, date, time, frequency
  FROM reminders
  WHERE phone = ? AND date = ?
  ORDER BY time ASC
`)

const selectWeekStmt = db.prepare(`
  SELECT id, type, title, date, time, frequency
  FROM reminders
  WHERE phone = ? AND date BETWEEN ? AND ?
  ORDER BY date ASC, time ASC
`)

app.post("/twilio/incoming", (req, res) => {
  const phone = req.body.From
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

  // Comandos globales
  if (normalized === "menu" || normalized === "menú" || normalized === "inicio" || normalized === "hola") {
    twiml.message(goMenu())
    return res.type("text/xml").send(twiml.toString())
  }
  if (normalized === "0" || normalized === "ayuda") {
    twiml.message(helpText)
    return res.type("text/xml").send(twiml.toString())
  }

  const session = sessions.get(phone) || { state: "MENU", data: {} }
  let replyText = ""

  switch (session.state) {
    // =========================
    // MENU
    // =========================
    case "MENU": {
      if (normalized === "1") {
        sessions.set(phone, { state: "ADD_APPT_TITLE", data: {} })
        replyText = "Perfecto ✅\n¿Cuál es la cita? (Ej: Cardiólogo, Terapia, Laboratorio)"
        break
      }

      if (normalized === "2") {
        sessions.set(phone, { state: "ADD_MED_NAME", data: {} })
        replyText = "Perfecto ✅\n¿Cuál medicina es? (Ej: Losartán, Insulina, Omeprazol)"
        break
      }

      if (normalized === "3") {
        const todayISO = dayjs().format("YYYY-MM-DD")
        const rows = selectTodayStmt.all(phone, todayISO)

        if (rows.length === 0) {
          replyText =
            `Hoy no tienes recordatorios ✅\n\n` +
            `Si quieres agendar uno, responde:\n` +
            `1) Cita\n2) Medicina\n\n` +
            `O escribe "menú".`
          break
        }

        const lines = rows.map((r) => {
          const typeLabel = r.type === "APPOINTMENT" ? "Cita" : "Medicina"
          const extra = r.type === "MEDICATION" && r.frequency ? ` (${r.frequency})` : ""
          return `${r.time} — ${typeLabel}: ${r.title}${extra}`
        })

        replyText = `Hoy tienes:\n${lines.join("\n")}\n\nPara ver la semana responde 4.`
        break
      }

      if (normalized === "4") {
        const { start, end } = getWeekRangeISO()
        const rows = selectWeekStmt.all(phone, start, end)

        if (rows.length === 0) {
          replyText =
            `Esta semana no tienes recordatorios ✅\n\n` +
            `Si quieres agendar uno, responde:\n` +
            `1) Cita\n2) Medicina\n\n` +
            `O escribe "menú".`
          break
        }

        const grouped = groupByDate(rows)
        const blocks = grouped.map((g) => {
          const header = `*${formatDateISOToDDMM(g.date)}*`
          const items = g.items.map((r) => {
            const typeLabel = r.type === "APPOINTMENT" ? "Cita" : "Medicina"
            const extra = r.type === "MEDICATION" && r.frequency ? ` (${r.frequency})` : ""
            return `- ${r.time} — ${typeLabel}: ${r.title}${extra}`
          })
          return `${header}\n${items.join("\n")}`
        })

        replyText =
          `Tu semana:\n\n${blocks.join("\n\n")}\n\n` +
          `Si quieres imprimir, luego haremos la opción 5 (PDF).`
        break
      }

      if (normalized === "5") {
        replyText =
          `Aún no genero el PDF 😊\n` +
          `Primero vamos a dejar perfectas las citas/medicinas.\n\n` +
          `Escribe "menú" para ver opciones.`
        break
      }

      if (normalized === "6") {
        replyText =
          `Esta opción la activamos después 😊\n` +
          `Por ahora, escribe "menú".`
        break
      }

      replyText = `No te entendí ⚠️\nResponde 1–6 o escribe "menú".`
      break
    }

    // =========================
    // AGENDAR CITA
    // =========================
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
      const iso = parseDDMMToISO(body)
      if (!iso) {
        replyText = "Fecha no válida ⚠️\nEscribe en formato DD/MM. Ej: 05/02"
        break
      }
      const data = session.data
      sessions.set(phone, { state: "ADD_APPT_TIME", data: { ...data, dateISO: iso, dateDDMM: body } })
      replyText = `Perfecto ✅ Día: ${body}\n\nAhora dime la hora (HH:MM). Ej: 16:30`
      break
    }

    case "ADD_APPT_TIME": {
      if (!isValidTimeHHMM(body)) {
        replyText = "Hora no válida ⚠️\nEscribe en formato HH:MM. Ej: 16:30"
        break
      }
      const data = session.data
      sessions.set(phone, { state: "ADD_APPT_CONFIRM", data: { ...data, time: body } })

      replyText =
        `CONFIRMA ✅\n` +
        `Cita: ${data.title}\n` +
        `Día: ${data.dateDDMM}\n` +
        `Hora: ${body}\n\n` +
        `1) Confirmar\n` +
        `2) Cambiar\n` +
        `0) Menú`
      break
    }

    case "ADD_APPT_CONFIRM": {
      if (normalized === "1") {
        const data = session.data
        insertReminderStmt.run({
          phone,
          type: "APPOINTMENT",
          title: data.title,
          date: data.dateISO,
          time: data.time,
          frequency: null,
          created_at: dayjs().toISOString()
        })

        sessions.set(phone, { state: "MENU", data: {} })
        replyText = `Listo ✅ Guardé tu cita.\n\nPuedes ver:\n3) Hoy\n4) Semana\n\nO escribe "menú".`
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

    // =========================
    // AGENDAR MEDICINA
    // =========================
    case "ADD_MED_NAME": {
      const name = body
      if (!name) {
        replyText = "Escribe el nombre de la medicina, por favor. (Ej: Losartán)"
        break
      }
      sessions.set(phone, { state: "ADD_MED_START_DATE", data: { name } })
      replyText = `Anotado ✅: ${name}\n\n¿Desde qué día empiezas? (DD/MM). Ej: 05/02`
      break
    }

    case "ADD_MED_START_DATE": {
      const iso = parseDDMMToISO(body)
      if (!iso) {
        replyText = "Fecha no válida ⚠️\nEscribe en formato DD/MM. Ej: 05/02"
        break
      }
      const data = session.data
      sessions.set(phone, { state: "ADD_MED_TIME", data: { ...data, startISO: iso, startDDMM: body } })
      replyText = `Perfecto ✅ Desde: ${body}\n\n¿A qué hora? (HH:MM). Ej: 08:00`
      break
    }

    case "ADD_MED_TIME": {
      if (!isValidTimeHHMM(body)) {
        replyText = "Hora no válida ⚠️\nEscribe en formato HH:MM. Ej: 08:00"
        break
      }
      const data = session.data
      sessions.set(phone, { state: "ADD_MED_FREQ", data: { ...data, time: body } })

      replyText =
        `Gracias ✅\n` +
        `¿Cada cuánto?\n` +
        `1) Diario\n` +
        `2) Lunes/Miércoles/Viernes\n` +
        `3) Solo una vez\n\n` +
        `Responde 1, 2 o 3.`
      break
    }

    case "ADD_MED_FREQ": {
      let freq = ""
      if (normalized === "1") freq = "DIARIO"
      else if (normalized === "2") freq = "LUN-MIE-VIE"
      else if (normalized === "3") freq = "UNA_VEZ"
      else {
        replyText = "Opción no válida ⚠️\nResponde 1, 2 o 3."
        break
      }

      const data = session.data
      sessions.set(phone, { state: "ADD_MED_CONFIRM", data: { ...data, frequency: freq } })

      replyText =
        `CONFIRMA ✅\n` +
        `Medicina: ${data.name}\n` +
        `Desde: ${data.startDDMM}\n` +
        `Hora: ${data.time}\n` +
        `Frecuencia: ${freq}\n\n` +
        `1) Confirmar\n` +
        `2) Cambiar\n` +
        `0) Menú`
      break
    }

    case "ADD_MED_CONFIRM": {
      if (normalized === "1") {
        const data = session.data
        // Guardamos como recordatorio para la fecha de inicio (demo). Luego expandimos a repetición real si quieres.
        insertReminderStmt.run({
          phone,
          type: "MEDICATION",
          title: data.name,
          date: data.startISO,
          time: data.time,
          frequency: data.frequency,
          created_at: dayjs().toISOString()
        })

        sessions.set(phone, { state: "MENU", data: {} })
        replyText = `Listo ✅ Guardé tu medicina.\n\nPuedes ver:\n3) Hoy\n4) Semana\n\nO escribe "menú".`
        break
      }
      if (normalized === "2") {
        const prev = session.data
        sessions.set(phone, { state: "ADD_MED_START_DATE", data: { name: prev.name } })
        replyText = `De acuerdo 👍\nRepite la fecha de inicio (DD/MM). Ej: 05/02`
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
