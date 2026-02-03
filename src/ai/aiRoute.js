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

const SYSTEM_PROMPT = [
  "Eres un clasificador de intención para un bot de WhatsApp llamado AgendaMayor.",
  "Debes responder SOLO JSON válido, sin texto extra ni markdown. Responde en JSON.",
  "Tu salida SIEMPRE debe seguir este formato:",
  "{",
  "  "intent": "ADD_APPOINTMENT" | "ADD_MEDICATION" | "VIEW_TODAY" | "VIEW_WEEK" | "GENERATE_PDF" | "HELP" | "CANCEL" | "UNKNOWN",",
  "  "confidence": 0.0,",
  "  "normalizedText": "",",
  "  "suggestedReply": "",",
  "  "extracted": {",
  "    "title": null,",
  "    "dateDDMM": null,",
  "    "timeHHMM": null,",
  "    "frequency": "DIARIO" | "LUN-MIE-VIE" | "UNA_VEZ" | null",
  "  }",
  "}",
  "Reglas estrictas:",
  "- No inventes fechas ni horas. Si no está claro, usa null.",
  "- No confirmes ni guardes recordatorios. Solo clasifica.",
  "- Si hay ambigüedad, usa intent UNKNOWN y confidence baja.",
  "- normalizedText en minúsculas y sin acentos.",
  "- suggestedReply debe ser corto (3-6 líneas), lenguaje simple y opciones claras.",
  "- Si errorCount >= 2 y el error es de formato, sugiere ejemplo y menciona "cancelar".",
  "- Tono amable, directo y calmado.",
  "- Idioma: español.",
  "Recuerda: responde SOLO JSON."
].join("
")

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
  // Fallback for chat.completions-like shape
  if (Array.isArray(data.choices) && data.choices[0]?.message?.content) {
    return data.choices[0].message.content
  }
  return ""
}

function safeJsonParse(text) {
  if (!text || typeof text !== "string") return null
  try {
    return JSON.parse(text)
  } catch (_) {
    // try to extract first JSON object
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start >= 0 && end > start) {
      const candidate = text.slice(start, end + 1)
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

async function aiRoute({ userText, currentState, errorCount, language = "es" }) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { ...DEFAULT_RESULT }

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
      return { ...DEFAULT_RESULT }
    }

    const data = await resp.json()
    const text = extractOutputText(data)
    const parsed = safeJsonParse(text)
    if (!parsed) return { ...DEFAULT_RESULT }
    return normalizeOutput(parsed)
  } catch (err) {
    console.error("[ai] Error llamando a OpenAI:", err)
    return { ...DEFAULT_RESULT }
  }
}

module.exports = { aiRoute }
