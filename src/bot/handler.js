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
  if (ai && ai.confidence < 0.7 && ai.suggestedReply && ai.suggestedReply.trim()) return ai.suggestedReply
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
  if (normalized === "menu" || normalized === "men\u00fa" || normalized === "inicio" || normalized === "hola") {
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
    twiml.message(`Cancelado \u2705\nEstoy aqu\u00ed para ayudarte.\n\n${menu}`)
    return res.type("text/xml").send(twiml.toString())
  }

  const session = getSession(phone)
  let replyText = ""

  switch (session.state) {
    case "MENU": {
      let menuChoice = normalized
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
            twiml.message(`Cancelado \u2705\nEstoy aqu\u00ed para ayudarte.\n\n${menu}`)
            return res.type("text/xml").send(twiml.toString())
          }
          if (mapped) {
            menuChoice = mapped
            resetErrors(phone)
          }
        }
        if (!["1", "2", "3", "4", "5", "6"].includes(menuChoice)) {
          replyText = `No te entend\u00ed \u26a0\ufe0f\nPero estoy aqu\u00ed para ayudarte.\nResponde 1\u20136 o escribe \"men\u00fa\".`
          break
        }
      } else {
        resetErrors(phone)
      }

      if (menuChoice === "1") {
        setSessionClean(phone, { state: "ADD_APPT_TITLE", data: {} })
        replyText = "Perfecto \u2705\n\u00bfCu\u00e1l es la cita? (Ej: Cardi\u00f3logo, Terapia, Laboratorio)"
        break
      }

      if (menuChoice === "2") {
        setSessionClean(phone, { state: "ADD_MED_NAME", data: {} })
        replyText = "Perfecto \u2705\n\u00bfCu\u00e1l medicina es? (Ej: Losart\u00e1n, Insulina, Omeprazol)"
        break
      }

      if (menuChoice === "3") {
        const todayISO = dayjs().format("YYYY-MM-DD")
        const rows = getToday(phone, todayISO)

        if (rows.length === 0) {
          replyText =
            `Hoy no tienes recordatorios \u2705\n\n` +
            `Si quieres agendar uno, responde:\n1) Cita\n2) Medicina\n\n` +
            `O escribe \"men\u00fa\".`
          break
        }

        const lines = rows.map((r) => {
          const typeLabel = r.type === "APPOINTMENT" ? "Cita" : "Medicina"
          const extra = r.type === "MEDICATION" && r.frequency ? ` (${r.frequency})` : ""
          return `${r.time} \u2014 ${typeLabel}: ${r.title}${extra}`
        })
        replyText = `Hoy tienes:\n${lines.join("\\n")}\n\nPara ver pr\u00f3ximos 7 d\u00edas responde 4.`
        break
      }

      if (menuChoice === "4") {
        const { start, end } = getNext7DaysRangeISO()
        const rangeLabel = `${formatDateISOToDDMM(start)} al ${formatDateISOToDDMM(end)}`
        const rows = getRange(phone, start, end)

        if (rows.length === 0) {
          replyText =
            `Pr\u00f3ximos 7 d\u00edas (${rangeLabel}):\n` +
            `No tienes recordatorios \u2705\n\n` +
            `Si quieres agendar uno, responde:\n1) Cita\n2) Medicina\n\n` +
            `O escribe \"men\u00fa\".`
          break
        }

        const grouped = groupByDate(rows)
        const blocks = grouped.map((g) => {
          const header = `*${formatDateISOToDDMM(g.date)}*`
          const items = g.items.map((r) => {
            const typeLabel = r.type === "APPOINTMENT" ? "Cita" : "Medicina"
            const extra = r.type === "MEDICATION" && r.frequency ? ` (${r.frequency})` : ""
            return `- ${r.time} \u2014 ${typeLabel}: ${r.title}${extra}`
          })
          return `${header}\n${items.join("\\n")}`
        })

        replyText = `Pr\u00f3ximos 7 d\u00edas (${rangeLabel}):\n\n${blocks.join("\\n\\n")}\n\nSi quieres imprimir, usa la opci\u00f3n 5 (PDF).`
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
            `Ocurri\u00f3 un error generando el PDF \u26a0\ufe0f\n\n` +
            `Intenta de nuevo m\u00e1s tarde o escribe 4 para ver pr\u00f3ximos 7 d\u00edas.`
          break
        }

        const publicBaseUrl = process.env.PUBLIC_BASE_URL || ""
        console.log("[pdf] PUBLIC_BASE_URL configurada:", publicBaseUrl ? "si" : "no")

        if (!publicBaseUrl) {
          replyText =
            `Gener\u00e9 el PDF \u2705 pero falta configurar PUBLIC_BASE_URL en Railway.\n\n` +
            `Railway \u2192 Variables \u2192 PUBLIC_BASE_URL = https://TU-DOMINIO\n\n` +
            `Mientras tanto escribe 4 para ver pr\u00f3ximos 7 d\u00edas.`
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
        twiml.message("Aqu\u00ed tienes tu PDF semanal \uD83E\uDDFE (letra grande)." ).media(mediaUrl)
        return res.type("text/xml").send(twiml.toString())
      }

      if (menuChoice === "6") {
        const current = getSupportContact(phone)
        if (current && current.contact_phone) {
          setSessionClean(phone, { state: "SUPPORT_EXISTING", data: { current } })
          replyText =
            `Tu contacto de apoyo actual es:\n` +
            `Nombre: ${current.name || "-"}\n` +
            `Tel\u00e9fono: ${current.contact_phone}\n\n` +
            `\u00bfQuieres cambiarlo?\n1) S\u00ed, cambiar\n0) Men\u00fa`
          break
        }
        setSessionClean(phone, { state: "SUPPORT_NAME", data: {} })
        replyText = "Perfecto.\nVamos a configurar un contacto de apoyo.\n\n\u00bfCu\u00e1l es el nombre del contacto?"
        break
      }

      replyText = `No te entend\u00ed \u26a0\ufe0f\nPero estoy aqu\u00ed para ayudarte.\nResponde 1\u20136 o escribe \"men\u00fa\".`
      break
    }

    // CITA
    case "ADD_APPT_TITLE": {
      if (!body) {
        replyText = await getAiHelpOrDefault({
          phone,
          userText: body,
          currentState: session.state,
          defaultReply: "Escribe el nombre de la cita, por favor. (Ej: Cardi\u00f3logo)"
        })
        break
      }
      setSessionClean(phone, { state: "ADD_APPT_DATE", data: { title: body } })
      replyText = `Anotado \u2705: ${body}\n\nAhora dime el d\u00eda (DD/MM). Ej: 05/02`
      break
    }

    case "ADD_APPT_DATE": {
      const iso = parseDDMMToISO(body)
      if (!iso) {
        replyText = await getAiHelpOrDefault({
          phone,
          userText: body,
          currentState: session.state,
          defaultReply: "Fecha no v\u00e1lida \u26a0\ufe0f\nEscribe en formato DD/MM. Ej: 05/02"
        })
        break
      }
      setSessionClean(phone, { state: "ADD_APPT_TIME", data: { ...session.data, dateISO: iso, dateDDMM: body } })
      replyText = `Perfecto \u2705 D\u00eda: ${body}\n\nAhora dime la hora (HH:MM). Ej: 16:30`
      break
    }

    case "ADD_APPT_TIME": {
      if (!isValidTimeHHMM(body)) {
        replyText = await getAiHelpOrDefault({
          phone,
          userText: body,
          currentState: session.state,
          defaultReply: "Hora no v\u00e1lida \u26a0\ufe0f\nEscribe en formato HH:MM. Ej: 16:30"
        })
        break
      }
      setSessionClean(phone, { state: "ADD_APPT_CONFIRM", data: { ...session.data, time: body } })
      replyText =
        `CONFIRMA \u2705\nCita: ${session.data.title}\nD\u00eda: ${session.data.dateDDMM}\nHora: ${body}\n\n` +
        `1) Confirmar\n2) Cambiar\n0) Men\u00fa`
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
        replyText = `Listo \u2705 Guard\u00e9 tu cita.\n\nPuedes ver:\n3) Hoy\n4) Pr\u00f3ximos 7 d\u00edas\n\nO escribe \"men\u00fa\".`
        break
      }
      if (normalized === "2") {
        setSessionClean(phone, { state: "ADD_APPT_DATE", data: { title: session.data.title } })
        replyText = `De acuerdo \uD83D\uDC4D\nRepite el d\u00eda (DD/MM). Ej: 05/02`
        break
      }
      replyText = `Responde 1 para confirmar, 2 para cambiar, o 0 para men\u00fa.`
      break
    }

    // MEDICINA
    case "ADD_MED_NAME": {
      if (!body) {
        replyText = await getAiHelpOrDefault({
          phone,
          userText: body,
          currentState: session.state,
          defaultReply: "Escribe el nombre de la medicina, por favor. (Ej: Losart\u00e1n)"
        })
        break
      }
      setSessionClean(phone, { state: "ADD_MED_START_DATE", data: { name: body } })
      replyText = `Anotado \u2705: ${body}\n\n\u00bfDesde qu\u00e9 d\u00eda empiezas? (DD/MM). Ej: 05/02`
      break
    }

    case "ADD_MED_START_DATE": {
      const iso = parseDDMMToISO(body)
      if (!iso) {
        replyText = await getAiHelpOrDefault({
          phone,
          userText: body,
          currentState: session.state,
          defaultReply: "Fecha no v\u00e1lida \u26a0\ufe0f\nEscribe en formato DD/MM. Ej: 05/02"
        })
        break
      }
      setSessionClean(phone, { state: "ADD_MED_TIME", data: { ...session.data, startISO: iso, startDDMM: body } })
      replyText = `Perfecto \u2705 Desde: ${body}\n\n\u00bfA qu\u00e9 hora? (HH:MM). Ej: 08:00`
      break
    }

    case "ADD_MED_TIME": {
      if (!isValidTimeHHMM(body)) {
        replyText = await getAiHelpOrDefault({
          phone,
          userText: body,
          currentState: session.state,
          defaultReply: "Hora no v\u00e1lida \u26a0\ufe0f\nEscribe en formato HH:MM. Ej: 08:00"
        })
        break
      }
      setSessionClean(phone, { state: "ADD_MED_FREQ", data: { ...session.data, time: body } })
      replyText =
        `Gracias \u2705\n\u00bfCada cu\u00e1nto?\n1) Diario\n2) Lunes/Mi\u00e9rcoles/Viernes\n3) Solo una vez\n\nResponde 1, 2 o 3.`
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
          defaultReply: "Opci\u00f3n no v\u00e1lida \u26a0\ufe0f\nResponde 1, 2 o 3."
        })
        break
      }

      setSessionClean(phone, { state: "ADD_MED_CONFIRM", data: { ...session.data, frequency: freq } })
      replyText =
        `CONFIRMA \u2705\nMedicina: ${session.data.name}\nDesde: ${session.data.startDDMM}\nHora: ${session.data.time}\nFrecuencia: ${freq}\n\n` +
        `1) Confirmar\n2) Cambiar\n0) Men\u00fa`
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
        replyText = `Listo \u2705 Guard\u00e9 tu medicina.\n\nPuedes ver:\n3) Hoy\n4) Pr\u00f3ximos 7 d\u00edas\n\nO escribe \"men\u00fa\".`
        break
      }
      if (normalized === "2") {
        setSessionClean(phone, { state: "ADD_MED_START_DATE", data: { name: session.data.name } })
        replyText = `De acuerdo \uD83D\uDC4D\nRepite la fecha de inicio (DD/MM). Ej: 05/02`
        break
      }
      replyText = `Responde 1 para confirmar, 2 para cambiar, o 0 para men\u00fa.`
      break
    }

    // CONTACTO DE APOYO
    case "SUPPORT_EXISTING": {
      if (normalized === "1") {
        setSessionClean(phone, { state: "SUPPORT_NAME", data: {} })
        replyText = "De acuerdo.\n\u00bfCu\u00e1l es el nombre del contacto de apoyo?"
        break
      }
      if (normalized === "0") {
        resetToMenu(phone)
        replyText = menu
        break
      }
      replyText = "Responde 1 para cambiar, o 0 para men\u00fa."
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
      replyText = "Gracias.\nAhora escribe el tel\u00e9fono del contacto (incluye c\u00f3digo de pa\u00eds). Ej: +593 99 460 1733"
      break
    }

    case "SUPPORT_PHONE": {
      const contactPhone = normalizeContactPhone(body)
      if (!contactPhone) {
        replyText = await getAiHelpOrDefault({
          phone,
          userText: body,
          currentState: session.state,
          defaultReply: "Tel\u00e9fono no v\u00e1lido.\nEscribe con c\u00f3digo de pa\u00eds. Ej: +593 99 460 1733"
        })
        break
      }
      setSessionClean(phone, {
        state: "SUPPORT_CONFIRM",
        data: { ...session.data, contactPhone }
      })
      replyText =
        `CONFIRMA\nNombre: ${session.data.name}\nTel\u00e9fono: ${contactPhone}\n\n` +
        `1) Confirmar\n2) Cambiar\n0) Men\u00fa`
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
        replyText = `Listo \u2705 Guard\u00e9 tu contacto de apoyo.\n\nEscribe \"men\u00fa\" para ver opciones.`
        break
      }
      if (normalized === "2") {
        setSessionClean(phone, { state: "SUPPORT_NAME", data: {} })
        replyText = "De acuerdo. Escribe el nombre del contacto de apoyo."
        break
      }
      replyText = `Responde 1 para confirmar, 2 para cambiar, o 0 para men\u00fa.`
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
