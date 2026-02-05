// server.js
const express = require("express")
const path = require("path")
const fs = require("fs")
const { handleIncoming } = require("./src/bot/handler")

const app = express()
app.use(express.urlencoded({ extended: false }))

app.get("/health", (req, res) => res.status(200).send("ok"))

// servir PDFs
app.get("/files/:name", (req, res) => {
  const safeName = path.basename(req.params.name)
  const filePath = path.resolve(__dirname, "files", safeName)
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found")
  res.type("application/pdf")
  return res.sendFile(filePath)
})

app.post("/twilio/incoming", handleIncoming)

const PORT = process.env.PORT || 8080
app.listen(PORT, () => {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || ""
  const geminiKey = process.env.GEMINI_API_KEY || ""
  const openaiKey = process.env.OPENAI_API_KEY || ""
  console.log(`Servidor corriendo en puerto ${PORT}`)
  console.log(`[startup] PUBLIC_BASE_URL configurada: ${publicBaseUrl ? "si" : "no"}`)
  console.log(`[startup] GEMINI_API_KEY configurada: ${geminiKey ? "si" : "no"}`)
  console.log(`[startup] OPENAI_API_KEY configurada: ${openaiKey ? "si" : "no"}`)
})
