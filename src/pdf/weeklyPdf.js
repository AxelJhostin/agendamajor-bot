// src/pdf/wooklyPdf.js
const path = require("path")
const fs = require("fs")
const PDFDocument = require("pdfkit")
const { ensureDir } = require("../utils/files")
const { formatDateISOToDDMM } = require("../utils/dates")

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

async function buildWeeklyPdf({ phone, startISO, endISO, rows }) {
  const filesDir = path.resolve(__dirname, "../../files")
  ensureDir(filesDir)

  const fileName = `agenda_${phone.replace(/[^0-9+]/g, "")}_${startISO}_to_${endISO}.pdf`
  const filePath = path.join(filesDir, fileName)

  const doc = new PDFDocument({ size: "A4", margin: 48 })
  const stream = fs.createWriteStream(filePath)
  doc.pipe(stream)
  const done = new Promise((resolve, reject) => {
    stream.on("finish", resolve)
    stream.on("error", reject)
  })

  doc.fontSize(22).text("AgendaMayor — Plan Semanal", { align: "center" })
  doc.moveDown(0.4)
  doc.fontSize(16).text(`Rango: ${formatDateISOToDDMM(startISO)} al ${formatDateISOToDDMM(endISO)}`, {
    align: "center"
  })
  doc.moveDown(1)

  if (!rows || rows.length === 0) {
    doc.fontSize(18).text("No hay recordatorios en este rango ✅")
    doc.moveDown(1)
    doc.fontSize(12).text("Tip: Puedes pegar este papel en la nevera o cerca de tu cama.")
    doc.end()
    await done
    return { fileName, filePath }
  }

  const grouped = groupByDate(rows)
  for (const g of grouped) {
    doc.fontSize(18).text(`${formatDateISOToDDMM(g.date)}`, { underline: true })
    doc.moveDown(0.3)

    for (const r of g.items) {
      const typeLabel = r.type === "APPOINTMENT" ? "Cita" : "Medicina"
      const extra = r.type === "MEDICATION" && r.frequency ? ` (${r.frequency})` : ""
      doc.fontSize(16).text(`• ${r.time} — ${typeLabel}: ${r.title}${extra}`)
    }

    doc.moveDown(0.8)
  }

  doc.moveDown(1)
  doc.fontSize(12).text("Tip: Puedes pegar este papel en la nevera o cerca de tu cama.")
  doc.end()
  await done
  return { fileName, filePath }
}

module.exports = { buildWeeklyPdf }
