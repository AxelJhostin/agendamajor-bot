// src/ai/aiRoute.js
const DEFAULT_RESULT = {
  intent: "UNKNOWN",
  confidence: 0,
  normalizedText: "",
  suggestedReply: "",
  extracted: { title: null, dateDDMM: null, timeHHMM: null, frequency: null }
}

const ALLOWED_INTENTS = new Set([
  "ADD_APPOINTMENT",
  "ADD_MEDICATION",
  "VIEW_TODAY",
  "VIEW_WEEK",
  "GENERATE_PDF",
  "HELP",
  "CANCEL",
  "UNKNOWN"
])

const ALLOWED_FREQUENCY = new Set(["DIARIO", "LUN-MIE-VIE", "UNA_VEZ"])

function normalizeBasic(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function extractDateDDMM(text) {
  const m = text.match(/\b([0-3]?\d)[\/\-]([01]?\d)\b/)
  if (!m) return null
  const dd = String(Number(m[1])).padStart(2, "0")
  const mm = String(Number(m[2])).padStart(2, "0")
  return `${dd}/${mm}`
}

function extractTime(text) {
  const m1 = text.match(/\b([01]?\d|2[0-3])[:.](\d{2})\b/)
  if (m1) return `${m1[1].padStart(2, "0")}:${m1[2]}`
  const m2 = text.match(/\b([1-9]|1[0-2])\s*(am|pm)\b/)
  if (m2) {
    let h = Number(m2[1])
    const pm = m2[2] === "pm"
    if (pm && h < 12) h += 12
    if (!pm && h === 12) h = 0
    return `${String(h).padStart(2, "0")}:00`
  }
  return null
}

function extractFrequency(text) {
  if (/\bdiario|cada dia|todos los dias|todas las noches|diaria\b/.test(text)) return "DIARIO"
  if (/\blunes.*miercoles.*viernes|\blun.*mie.*vie\b/.test(text)) return "LUN-MIE-VIE"
  if (/\buna vez|solo una vez|unica vez|por unica vez\b/.test(text)) return "UNA_VEZ"
  return null
}

function localRoute({ userText }) {
  const normalized = normalizeBasic(userText)
  const extracted = {
    title: null,
    dateDDMM: extractDateDDMM(normalized),
    timeHHMM: extractTime(normalized),
    frequency: extractFrequency(normalized)
  }

  const has = (re) => re.test(normalized)
  if (
    has(/\bagendar|programar|reservar|sacar cita|poner cita|cita medica|turno|turnito|separar cita|pedir cita\b/) &&
    has(/\bcita|doctor|medico|consulta|especialista|clinica|hospital|odontologo|dentista|pediatra|cardiologo|ginecologo\b/)
  ) {
    return {
      intent: "ADD_APPOINTMENT",
      confidence: 0.8,
      normalizedText: "agendar cita",
      suggestedReply: "",
      extracted
    }
  }
  if (
    has(/\bmedicina|medicamento|pastilla|pastillita|tableta|inyeccion|jarabe|capsula|vitamina|insulina|gotas|spray|paracetamol|ibuprofeno|losartan|omeprazol\b/)
  ) {
    return {
      intent: "ADD_MEDICATION",
      confidence: 0.78,
      normalizedText: "agendar medicina",
      suggestedReply:
        extracted.timeHHMM || extracted.frequency || extracted.dateDDMM
          ? "Perfecto \u2705 Vamos paso a paso. \u00bfCu\u00e1l es la medicina? (Ej: Losart\u00e1n)"
          : "",
      extracted
    }
  }
  if (has(/\bhoy\b|para hoy|del dia|que tengo hoy|tengo hoy|hoy que hay\b/)) {
    return {
      intent: "VIEW_TODAY",
      confidence: 0.9,
      normalizedText: "ver hoy",
      suggestedReply: "",
      extracted
    }
  }
  if (
    has(/\bsemana|semanal|proximos 7 dias|proximos siete dias|esta semana|mi semana|proxima semana|siguiente semana|7 dias|siete dias\b/)
  ) {
    return {
      intent: "VIEW_WEEK",
      confidence: 0.9,
      normalizedText: "ver semana",
      suggestedReply: "",
      extracted
    }
  }
  if (
    has(/\bpdf\b|imprimir|imprime|imprimeme|semana en pdf|pdf semanal|agenda en pdf|mandame el pdf|manda el pdf|en pdf|sacar pdf|descargar pdf\b/)
  ) {
    return {
      intent: "GENERATE_PDF",
      confidence: 0.9,
      normalizedText: "pdf semanal",
      suggestedReply: "",
      extracted
    }
  }
  if (
    has(/\bayuda|menu|opciones|no entiendo|no comprendo|explicame|explica|como funciona|que hago|guia|instrucciones\b/)
  ) {
    return {
      intent: "HELP",
      confidence: 0.85,
      normalizedText: "ayuda",
      suggestedReply: "",
      extracted
    }
  }
  if (has(/\bcancelar|cancel|anular|volver|salir|atras\b/)) {
    return {
      intent: "CANCEL",
      confidence: 0.85,
      normalizedText: "cancelar",
      suggestedReply: "",
      extracted
    }
  }

  return { ...DEFAULT_RESULT }
}

const SYSTEM_PROMPT = [
  "Eres un clasificador de intencion para un bot de WhatsApp llamado AgendaMayor.",
  "Debes responder SOLO JSON valido, sin texto extra ni markdown.",
  "Tu salida SIEMPRE debe seguir este formato:",
  "{",
  '  "intent": "ADD_APPOINTMENT" | "ADD_MEDICATION" | "VIEW_TODAY" | "VIEW_WEEK" | "GENERATE_PDF" | "HELP" | "CANCEL" | "UNKNOWN",',
  '  "confidence": 0.0,',
  '  "normalizedText": "",',
  '  "suggestedReply": "",',
  '  "extracted": {',
  '    "title": null,',
  '    "dateDDMM": null,',
  '    "timeHHMM": null,',
  '    "frequency": "DIARIO" | "LUN-MIE-VIE" | "UNA_VEZ" | null',
  "  }",
  "}",
  "Reglas estrictas:",
  "- No inventes fechas ni horas. Si no esta claro, usa null.",
  "- No confirmes ni guardes recordatorios. Solo clasifica.",
  "- Si hay ambiguedad, usa intent UNKNOWN y confidence baja.",
  "- normalizedText en minusculas y sin acentos.",
  "- suggestedReply debe ser corto (3-6 lineas), lenguaje simple y opciones claras.",
  "- Si errorCount >= 2 y el error es de formato, sugiere ejemplo y menciona \"cancelar\".",
  "- Tono amable, directo y calmado.",
  "- Idioma: espanol.",
  "Recuerda: responde SOLO JSON."
].join("\n")

function extractOutputText(data) {
  if (!data) return ""
  if (typeof data.output_text === "string") return data.output_text
  if (Array.isArray(data.output)) {
    let text = ""
    for (const item of data.output) {
      if (item && item.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c && c.type === "output_text" && typeof c.text === "string") {
            text += c.text
          }
        }
      }
    }
    return text
  }
  if (Array.isArray(data.choices) && data.choices[0]?.message?.content) {
    return data.choices[0].message.content
  }
  return ""
}

function extractGeminiText(data) {
  if (!data || !Array.isArray(data.candidates)) return ""
  const parts = data.candidates[0]?.content?.parts
  if (!Array.isArray(parts)) return ""
  return parts.map((p) => (p && typeof p.text === "string" ? p.text : "")).join("")
}

function stripCodeFences(text) {
  return text
    .replace(/```json/gi, "```")
    .replace(/```/g, "")
    .trim()
}

function removeTrailingCommas(text) {
  return text
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
}

function safeJsonParse(text) {
  if (!text || typeof text !== "string") return null
  try {
    return JSON.parse(text)
  } catch (_) {
    const cleaned = removeTrailingCommas(stripCodeFences(text))
    try {
      return JSON.parse(cleaned)
    } catch (_) {}
    const start = cleaned.indexOf("{")
    const end = cleaned.lastIndexOf("}")
    if (start >= 0 && end > start) {
      const candidate = removeTrailingCommas(cleaned.slice(start, end + 1))
      try {
        return JSON.parse(candidate)
      } catch (_) {
        return null
      }
    }
    return null
  }
}

function normalizeOutput(obj) {
  const out = { ...DEFAULT_RESULT, ...(obj || {}) }
  if (!ALLOWED_INTENTS.has(out.intent)) out.intent = "UNKNOWN"
  out.confidence = typeof out.confidence === "number" ? Math.max(0, Math.min(1, out.confidence)) : 0
  out.normalizedText = typeof out.normalizedText === "string" ? out.normalizedText : ""
  out.suggestedReply = typeof out.suggestedReply === "string" ? out.suggestedReply : ""
  const extracted = out.extracted && typeof out.extracted === "object" ? out.extracted : {}
  out.extracted = {
    title: typeof extracted.title === "string" ? extracted.title : null,
    dateDDMM: typeof extracted.dateDDMM === "string" ? extracted.dateDDMM : null,
    timeHHMM: typeof extracted.timeHHMM === "string" ? extracted.timeHHMM : null,
    frequency: ALLOWED_FREQUENCY.has(extracted.frequency) ? extracted.frequency : null
  }
  return out
}

async function callGemini({ userText, currentState, errorCount, language }) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash"
  const payload = {
    systemInstruction: {
      role: "system",
      parts: [{ text: SYSTEM_PROMPT }]
    },
    contents: [
      {
        role: "user",
        parts: [
          { text: JSON.stringify({ userText, currentState, errorCount, language }) }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 350,
      responseMimeType: "application/json"
    }
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "")
      console.error("[ai] Gemini error:", resp.status, errText)
      return null
    }

    const data = await resp.json()
    const text = extractGeminiText(data)
    if (!text) {
      console.error("[ai] Gemini response without text")
      return null
    }
    const parsed = safeJsonParse(text)
    if (!parsed) {
      const preview = text ? text.slice(0, 600) : ""
      console.error("[ai] Gemini JSON parse failed. Preview:", JSON.stringify(preview))
      return null
    }
    return normalizeOutput(parsed)
  } catch (err) {
    console.error("[ai] Error llamando a Gemini:", err)
    return null
  }
}

async function callOpenAI({ userText, currentState, errorCount, language }) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini"
  const payload = {
    model,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({ userText, currentState, errorCount, language })
      }
    ],
    text: { format: { type: "json_object" } },
    temperature: 0.2,
    max_output_tokens: 350
  }

  try {
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    })

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "")
      console.error("[ai] OpenAI error:", resp.status, errText)
      return null
    }

    const data = await resp.json()
    const text = extractOutputText(data)
    const parsed = safeJsonParse(text)
    if (!parsed) return null
    return normalizeOutput(parsed)
  } catch (err) {
    console.error("[ai] Error llamando a OpenAI:", err)
    return null
  }
}

async function aiRoute({ userText, currentState, errorCount, language = "es" }) {
  const gemini = await callGemini({ userText, currentState, errorCount, language })
  if (gemini) return gemini

  const openai = await callOpenAI({ userText, currentState, errorCount, language })
  if (openai) return openai

  return localRoute({ userText, currentState, errorCount, language })
}

module.exports = { aiRoute }
