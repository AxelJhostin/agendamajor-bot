const express = require("express")
const path = require("path")
const { handleIncoming } = require("./src/bot/handler")

const app = express()
app.use(express.urlencoded({ extended: false }))

app.get("/health", (req, res) => res.status(200).send("ok"))

// servir PDFs
app.get("/files/:name", (req, res) => {
  const safeName = path.basename(req.params.name)
  const filePath = path.resolve(__dirname, "files", safeName)
  res.sendFile(filePath)
})

app.post("/twilio/incoming", handleIncoming)

const PORT = process.env.PORT || 8080
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`))
