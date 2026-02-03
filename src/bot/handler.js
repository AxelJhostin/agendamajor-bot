// src/bot/handler.js
const twilio = require("twilio")
const dayjs = require("dayjs")
const { buildMenu, buildHelp } = require("./messages")
const { getSession, setSession, resetToMenu, incrementErrors, resetErrors } = require("./sessions")
const { parseDDMMToISO, isValidTimeHHMM, formatDateISOToDDMM, getNext7DaysRangeISO } = require("../utils/dates")
const { insertReminder, getToday, getRange, upsertSupportContact, getSupportContact } = require("../db")
const { buildWeeklyPdf } = require("../pdf/weeklyPdf")
const { aiRoute } = require("../ai/aiRoute")

function groupByDate(items) {
  const map = new Map()
  for (const it of items) {
    if (!map.has(it.date)) map.set(it.date, [])
    map.get(it.date).push(it)
  }
  const dates = Array.from(map.keys()).sort()
  return dates.map((date) => ({
    date,
    items: map.get(date).sort((a, b) => a.time.localeCompare(b.time))
  }))
}

function normalizeContactPhone(input) {
  const raw = (input || "").trim()
  const cleaned = raw.replace(/[^\d+]/g, "")
  const digits = cleaned.replace(/\D/g, "")
  if (digits.length < 7) return null
  return cleaned.startsWith("+") ? `+${digits}` : digits
}

function setSessionClean(phone, session) {
  setSession(phone, session)
  resetErrors(phone)
}

const INTENT_TO_MENU = {
  ADD_APPOINTMENT: "1",
  ADD_MEDICATION: "2",
  VIEW_TODAY: "3",
  VIEW_WEEK: "4",
  GENERATE_PDF: "5",
  HELP: "HELP",
  CANCEL: "CANCEL"
}

function mapIntentToMenuChoice(intent) {
  return INTENT_TO_MENU[intent] || null
}

async function getAiHelpOrDefault({ phone, userText, currentState, defaultReply }) {
  const errorCount = incrementErrors(phone)
  if (errorCount < 2) return defaultReply
  const ai = await aiRoute({ userText, currentState, errorCount, language: "es" })
  if (ai && ai.suggestedReply && ai.suggestedReply.trim()) return ai.suggestedReply
  return defaultReply
}

async function handleIncoming(req, res) {
  const phone = req.body.From
  const body = (req.body.Body || "").trim()
  const normalized = body.toLowerCase()

  const twiml = new twilio.twiml.MessagingResponse()
  const menu = buildMenu()
  const helpText = buildHelp()

  // Comandos globales
  if (normalized === "menu" || normalized === "menú" || normalized === "inicio" || normalized === "hola") {
    resetToMenu(phone)
    twiml.message(menu)
    return res.type("text/xml").send(twiml.toString())
  }

  if (normalized === "0" || normalized === "ayuda") {
    twiml.message(helpText)
    return res.type("text/xml").send(twiml.toString())
  }

  if (normalized === "cancelar" || normalized === "cancel") {
    resetToMenu(phone)
    twiml.message(`Cancelado ✅\n\n${menu}`)
    return res.type("text/xml").send(twiml.toString())
  }

  const session = getSession(phone)
  let replyText = ""

  switch (session.state) {
    case "MENU": {
      let menuChoice = normalized
      let aiSuggestedReply = ""
      let ai = null

      if (!["1", "2", "3", "4", "5", "6"].includes(menuChoice)) {
        const errorCount = incrementErrors(phone)
        ai = await aiRoute({ userText: body, currentState: "MENU", errorCount, language: "es" })
        if (ai && ai.confidence >= 0.7) {
          const mapped = mapIntentToMenuChoice(ai.intent)
          if (mapped === "HELP") {
            resetErrors(phone)
            twiml.message(helpText)
            return res.type("text/xml").send(twiml.toString())
          }
          if (mapped === "CANCEL") {
            resetToMenu(phone)
            twiml.message(`Cancelado ✅

${menu}`)
            return res.type("text/xml").send(twiml.toString())
          }
          if (mapped) {
            menuChoice = mapped
            aiSuggestedReply = ai.suggestedReply || ""
            resetErrors(phone)
          }
        }
        if (!["1", "2", "3", "4", "5", "6"].includes(menuChoice)) {
          if (ai && ai.suggestedReply && ai.suggestedReply.trim()) {
            replyText = ai.suggestedReply
          } else {
            replyText = `No te entendí ⚠️
Responde 1–6 o escribe "menú".`
          }
          break
        }
      } else {
        resetErrors(phone)
      }

      if (menuChoice === "1") {
        setSessionClean(phone, { state: "ADD_APPT_TITLE", data: {} })
        replyText =
          aiSuggestedReply ||
          "Perfecto\n\u00bfCu\u00e1l es la cita? (Ej: Cardi\u00f3logo, Terapia, Laboratorio)"
        break
      }

      if (menuChoice === "2") {
        setSessionClean(phone, { state: "ADD_MED_NAME", data: {} })
        replyText =
          aiSuggestedReply ||
          "Perfecto\n\u00bfCu\u00e1l medicina es? (Ej: Losart\u00e1n, Insulina, Omeprazol)"
        break
      }

      if (menuChoice === "3") {
        const todayISO = dayjs().format("YYYY-MM-DD")
        const rows = getToday(phone, todayISO)

        if (rows.length === 0) {
          replyText =
            `Hoy no tienes recordatorios ✅

` +
            `Si quieres agendar uno, responde:
1) Cita
2) Medicina

` +
            `O escribe "menú".`
          break
        }

        const lines = rows.map((r) => {
          const typeLabel = r.type === "APPOINTMENT" ? "Cita" : "Medicina"
          const extra = r.type === "MEDICATION" && r.frequency ? ` (${r.frequency})` : ""
          return `${r.time} — ${typeLabel}: ${r.title}${extra}`
        })
        replyText = `Hoy tienes:
${lines.join("\n")}

Para ver próximos 7 días responde 4.`
        break
      }

      if (menuChoice === "4") {
        const { start, end } = getNext7DaysRangeISO()
        const rangeLabel = `${formatDateISOToDDMM(start)} al ${formatDateISOToDDMM(end)}`
        const rows = getRange(phone, start, end)

        if (rows.length === 0) {
          replyText =
            `Próximos 7 días (${rangeLabel}):
` +
            `No tienes recordatorios ✅

` +
            `Si quieres agendar uno, responde:
1) Cita
2) Medicina

` +
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
          return `${header}
${items.join("\n")}`
        })

        replyText = `Próximos 7 días (${rangeLabel}):

${blocks.join("\n\n")}

Si quieres imprimir, usa la opción 5 (PDF).`
        break
      }

      if (menuChoice === "5") {
        const { start, end } = getNext7DaysRangeISO()
        const rows = getRange(phone, start, end)

        let fileName = ""
        const supportContact = getSupportContact(phone)
        try {
          const result = await buildWeeklyPdf({
            phone,
            startISO: start,
            endISO: end,
            rows,
            supportContact
          })
          fileName = result.fileName
        } catch (err) {
          console.error("[pdf] Error generando PDF:", err)
          replyText =
            `Ocurrió un error generando el PDF ⚠️

` +
            `Intenta de nuevo más tarde o escribe 4 para ver próximos 7 días.`
          break
        }

        const publicBaseUrl = process.env.PUBLIC_BASE_URL || ""
        console.log("[pdf] PUBLIC_BASE_URL configurada:", publicBaseUrl ? "si" : "no")

        if (!publicBaseUrl) {
          replyText =
            `Generé el PDF ✅ pero falta configurar PUBLIC_BASE_URL en Railway.

` +
            `Railway → Variables → PUBLIC_BASE_URL = https://TU-DOMINIO

` +
            `Mientras tanto escribe 4 para ver próximos 7 días.`
          break
        }

        let baseUrl = publicBaseUrl.trim().replace(/\/+$/, "")
        if (!/^https?:\/\//i.test(baseUrl)) {
          console.warn("[pdf] PUBLIC_BASE_URL sin esquema, asumiendo https://")
          baseUrl = `https://${baseUrl}`
        }
        if (/^http:\/\//i.test(baseUrl)) {
          console.warn("[pdf] PUBLIC_BASE_URL es http, forzando https")
          baseUrl = baseUrl.replace(/^http:\/\//i, "https://")
        }
        const mediaUrl = `${baseUrl}/files/${encodeURIComponent(fileName)}`
        twiml.message("Aquí tienes tu PDF semanal 🧾 (letra grande).").media(mediaUrl)
        return res.type("text/xml").send(twiml.toString())
      }

      if (menuChoice === "6") {
        const current = getSupportContact(phone)
        if (current && current.contact_phone) {
          setSessionClean(phone, { state: "SUPPORT_EXISTING", data: { current } })
          replyText =
            `Tu contacto de apoyo actual es:
` +
            `Nombre: ${current.name || "-"}
` +
            `Teléfono: ${current.contact_phone}

` +
            `¿Quieres cambiarlo?
1) Sí, cambiar
0) Menú`
          break
        }
        setSessionClean(phone, { state: "SUPPORT_NAME", data: {} })
        replyText = "Perfecto.\nVamos a configurar un contacto de apoyo.\n\n\u00bfCu\u00e1l es el nombre del contacto?"
        break
      }

      replyText = `No te entendí ⚠️
Responde 1–6 o escribe "menú".`
      break
    }

    // CITA
    case "ADD_APPT_TITLE": {
      if (!body) {
        replyText = await getAiHelpOrDefault({
          phone,
          userText: body,
          currentState: session.state,
          defaultReply: "Escribe el nombre de la cita, por favor. (Ej: Cardiólogo)"
        })
        break
      }
      setSessionClean(phone, { state: "ADD_APPT_DATE", data: { title: body } })
      replyText = `Anotado ✅: ${body}\n\nAhora dime el día (DD/MM). Ej: 05/02`
      break
    }

    case "ADD_APPT_DATE": {
      const iso = parseDDMMToISO(body)
      if (!iso) {
        replyText = await getAiHelpOrDefault({
          phone,
          userText: body,
          currentState: session.state,
          defaultReply: "Fecha no válida ⚠️\nEscribe en formato DD/MM. Ej: 05/02"
        })
        break
      }
      setSessionClean(phone, { state: "ADD_APPT_TIME", data: { ...session.data, dateISO: iso, dateDDMM: body } })
      replyText = `Perfecto ✅ Día: ${body}\n\nAhora dime la hora (HH:MM). Ej: 16:30`
      break
    }

    case "ADD_APPT_TIME": {
      if (!isValidTimeHHMM(body)) {
        replyText = await getAiHelpOrDefault({
          phone,
          userText: body,
          currentState: session.state,
          defaultReply: "Hora no válida ⚠️\nEscribe en formato HH:MM. Ej: 16:30"
        })
        break
      }
      setSessionClean(phone, { state: "ADD_APPT_CONFIRM", data: { ...session.data, time: body } })
      replyText =
        `CONFIRMA ✅\nCita: ${session.data.title}\nDía: ${session.data.dateDDMM}\nHora: ${body}\n\n` +
        `1) Confirmar\n2) Cambiar\n0) Menú`
      break
    }

    case "ADD_APPT_CONFIRM": {
      if (normalized === "1") {
        insertReminder({
          phone,
          type: "APPOINTMENT",
          title: session.data.title,
          date: session.data.dateISO,
          time: session.data.time,
          frequency: null
        })
        resetToMenu(phone)
        replyText = `Listo ✅ Guardé tu cita.\n\nPuedes ver:\n3) Hoy\n4) Próximos 7 días\n\nO escribe "menú".`
        break
      }
      if (normalized === "2") {
        setSessionClean(phone, { state: "ADD_APPT_DATE", data: { title: session.data.title } })
        replyText = `De acuerdo 👍\nRepite el día (DD/MM). Ej: 05/02`
        break
      }
      replyText = `Responde 1 para confirmar, 2 para cambiar, o 0 para menú.`
      break
    }

    // MEDICINA
    case "ADD_MED_NAME": {
      if (!body) {
        replyText = await getAiHelpOrDefault({
          phone,
          userText: body,
          currentState: session.state,
          defaultReply: "Escribe el nombre de la medicina, por favor. (Ej: Losartán)"
        })
        break
      }
      setSessionClean(phone, { state: "ADD_MED_START_DATE", data: { name: body } })
      replyText = `Anotado ✅: ${body}\n\n¿Desde qué día empiezas? (DD/MM). Ej: 05/02`
      break
    }

    case "ADD_MED_START_DATE": {
      const iso = parseDDMMToISO(body)
      if (!iso) {
        replyText = await getAiHelpOrDefault({
          phone,
          userText: body,
          currentState: session.state,
          defaultReply: "Fecha no válida ⚠️\nEscribe en formato DD/MM. Ej: 05/02"
        })
        break
      }
      setSessionClean(phone, { state: "ADD_MED_TIME", data: { ...session.data, startISO: iso, startDDMM: body } })
      replyText = `Perfecto ✅ Desde: ${body}\n\n¿A qué hora? (HH:MM). Ej: 08:00`
      break
    }

    case "ADD_MED_TIME": {
      if (!isValidTimeHHMM(body)) {
        replyText = await getAiHelpOrDefault({
          phone,
          userText: body,
          currentState: session.state,
          defaultReply: "Hora no válida ⚠️\nEscribe en formato HH:MM. Ej: 08:00"
        })
        break
      }
      setSessionClean(phone, { state: "ADD_MED_FREQ", data: { ...session.data, time: body } })
      replyText =
        `Gracias ✅\n¿Cada cuánto?\n1) Diario\n2) Lunes/Miércoles/Viernes\n3) Solo una vez\n\nResponde 1, 2 o 3.`
      break
    }

    case "ADD_MED_FREQ": {
      let freq = ""
      if (normalized === "1") freq = "DIARIO"
      else if (normalized === "2") freq = "LUN-MIE-VIE"
      else if (normalized === "3") freq = "UNA_VEZ"
      else {
        replyText = await getAiHelpOrDefault({
          phone,
          userText: body,
          currentState: session.state,
          defaultReply: "Opción no válida ⚠️\nResponde 1, 2 o 3."
        })
        break
      }

      setSessionClean(phone, { state: "ADD_MED_CONFIRM", data: { ...session.data, frequency: freq } })
      replyText =
        `CONFIRMA ✅\nMedicina: ${session.data.name}\nDesde: ${session.data.startDDMM}\nHora: ${session.data.time}\nFrecuencia: ${freq}\n\n` +
        `1) Confirmar\n2) Cambiar\n0) Menú`
      break
    }

    case "ADD_MED_CONFIRM": {
      if (normalized === "1") {
        insertReminder({
          phone,
          type: "MEDICATION",
          title: session.data.name,
          date: session.data.startISO,
          time: session.data.time,
          frequency: session.data.frequency
        })
        resetToMenu(phone)
        replyText = `Listo ✅ Guardé tu medicina.\n\nPuedes ver:\n3) Hoy\n4) Próximos 7 días\n\nO escribe "menú".`
        break
      }
      if (normalized === "2") {
        setSessionClean(phone, { state: "ADD_MED_START_DATE", data: { name: session.data.name } })
        replyText = `De acuerdo 👍\nRepite la fecha de inicio (DD/MM). Ej: 05/02`
        break
      }
      replyText = `Responde 1 para confirmar, 2 para cambiar, o 0 para menú.`
      break
    }

    // CONTACTO DE APOYO
    case "SUPPORT_EXISTING": {
      if (normalized === "1") {
        setSessionClean(phone, { state: "SUPPORT_NAME", data: {} })
        replyText = "De acuerdo.\n¿Cuál es el nombre del contacto de apoyo?"
        break
      }
      if (normalized === "0") {
        resetToMenu(phone)
        replyText = menu
        break
      }
      replyText = "Responde 1 para cambiar, o 0 para menú."
      break
    }

    case "SUPPORT_NAME": {
      if (!body) {
        replyText = await getAiHelpOrDefault({
                  phone,
        userText: body,
        currentState: session.state,
        defaultReply: "Escribe el nombre del contacto de apoyo, por favor."
      })
        break
      }
      setSessionClean(phone, { state: "SUPPORT_PHONE", data: { name: body } })
        replyText = "Gracias.\nAhora escribe el teléfono del contacto (incluye código de país). Ej: +593 99 460 1733"
      break
    }

    case "SUPPORT_PHONE": {
      const contactPhone = normalizeContactPhone(body)
      if (!contactPhone) {
        replyText = await getAiHelpOrDefault({
          phone,
          userText: body,
          currentState: session.state,
          defaultReply: "Teléfono no válido.\nEscribe con código de país. Ej: +593 99 460 1733"
        })
        break
      }
      setSessionClean(phone, {
        state: "SUPPORT_CONFIRM",
        data: { ...session.data, contactPhone }
      })
      replyText =
        `CONFIRMA\nNombre: ${session.data.name}\nTeléfono: ${contactPhone}\n\n` +
        `1) Confirmar\n2) Cambiar\n0) Menú`
      break
    }

    case "SUPPORT_CONFIRM": {
      if (normalized === "1") {
        upsertSupportContact({
          phone,
          name: session.data.name,
          contactPhone: session.data.contactPhone
        })
        resetToMenu(phone)
        replyText = `Listo ✅ Guardé tu contacto de apoyo.\n\nEscribe "menú" para ver opciones.`
        break
      }
      if (normalized === "2") {
        setSessionClean(phone, { state: "SUPPORT_NAME", data: {} })
        replyText = "De acuerdo. Escribe el nombre del contacto de apoyo."
        break
      }
      replyText = `Responde 1 para confirmar, 2 para cambiar, o 0 para menú.`
      break
    }

    default: {
      resetToMenu(phone)
      replyText = menu
      break
    }
  }

  twiml.message(replyText)
  res.type("text/xml").send(twiml.toString())
}

module.exports = { handleIncoming }
