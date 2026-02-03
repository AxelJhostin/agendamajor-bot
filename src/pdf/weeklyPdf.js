// src/pdf/weeklyPdf.js
const path = require("path")
const fs = require("fs")
const PDFDocument = require("pdfkit")
const { ensureDir } = require("../utils/files")
const { formatDateISOToDDMM } = require("../utils/dates")

const COLORS = {
  primary: "#1b2a3a",
  secondary: "#4b5b6b",
  text: "#111827",
  softBg: "#f1f5f9",
  border: "#d6dde5"
}

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

function drawDivider(doc, margin, width) {
  doc.strokeColor(COLORS.border).lineWidth(1)
  doc.moveTo(margin, doc.y).lineTo(margin + width, doc.y).stroke()
  doc.moveDown(0.8)
}

function drawSectionHeader(doc, label, margin, width) {
  const x = margin
  const y = doc.y
  const height = 28

  doc.save()
  doc.fillColor(COLORS.softBg).roundedRect(x, y, width, height, 6).fill()
  doc.strokeColor(COLORS.border).lineWidth(1).roundedRect(x, y, width, height, 6).stroke()
  doc.fillColor(COLORS.primary).font("Helvetica-Bold").fontSize(18)
  doc.text(label, x + 10, y + 6, { width: width - 20 })
  doc.restore()

  doc.y = y + height + 10
}

function drawNoItemsCard(doc, margin, width) {
  const x = margin
  const y = doc.y + 10
  const height = 120

  doc.save()
  doc.fillColor(COLORS.softBg).roundedRect(x, y, width, height, 10).fill()
  doc.strokeColor(COLORS.border).lineWidth(1).roundedRect(x, y, width, height, 10).stroke()
  doc.restore()

  doc.fillColor(COLORS.primary).font("Helvetica-Bold").fontSize(20)
  doc.text("No hay recordatorios en este rango \u2705", x + 12, y + 22, {
    width: width - 24,
    align: "center"
  })
  doc.fillColor(COLORS.secondary).font("Helvetica").fontSize(14)
  doc.text("Tip: Puedes pegar este papel en la nevera o cerca de tu cama.", x + 12, y + 70, {
    width: width - 24,
    align: "center"
  })

  doc.y = y + height + 12
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

  const margin = doc.page.margins.left
  const contentWidth = doc.page.width - margin * 2

  doc.fillColor(COLORS.primary).font("Helvetica-Bold").fontSize(30)
  doc.text("AgendaMayor \u2014 Plan Semanal", { align: "center" })
  doc.moveDown(0.3)
  doc.fillColor(COLORS.secondary).font("Helvetica").fontSize(18)
  doc.text(`Rango: ${formatDateISOToDDMM(startISO)} al ${formatDateISOToDDMM(endISO)}`, { align: "center" })
  doc.moveDown(0.8)

  drawDivider(doc, margin, contentWidth)

  if (!rows || rows.length === 0) {
    drawNoItemsCard(doc, margin, contentWidth)
    doc.end()
    await done
    return { fileName, filePath }
  }

  const grouped = groupByDate(rows)
  for (const g of grouped) {
    drawSectionHeader(doc, formatDateISOToDDMM(g.date), margin, contentWidth)

    for (const r of g.items) {
      const typeLabel = r.type === "APPOINTMENT" ? "Cita" : "Medicina"
      const extra = r.type === "MEDICATION" && r.frequency ? ` (${r.frequency})` : ""
      const line = `\u2022 ${r.time} \u2014 ${typeLabel}: ${r.title}${extra}`
      doc.fillColor(COLORS.text).font("Helvetica").fontSize(16)
      doc.text(line, { width: contentWidth, lineGap: 4 })
    }

    doc.moveDown(0.6)
  }

  doc.moveDown(0.4)
  doc.fillColor(COLORS.secondary).font("Helvetica").fontSize(14)
  doc.text("Tip: Puedes pegar este papel en la nevera o cerca de tu cama.", { align: "center" })

  doc.end()
  await done
  return { fileName, filePath }
}

module.exports = { buildWeeklyPdf }
