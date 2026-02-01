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
  twiml.message(
    `Hola 👋 Soy AgendaMayor.\nRecibí tu mensaje: "${body}"\n\nResponde:\n1) Menú`
  )

  res.type("text/xml").send(twiml.toString())
})

const PORT = process.env.PORT || 8080
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`)
})
