// src/utils/date.js
const dayjs = require("dayjs")

function parseDDMMToISO(ddmm) {
  const m = ddmm.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (!m) return null
  const dd = Number(m[1])
  const mm = Number(m[2])
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null

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

function getNext7DaysRangeISO() {
  const start = dayjs().startOf("day")
  const end = start.add(6, "day")
  return { start: start.format("YYYY-MM-DD"), end: end.format("YYYY-MM-DD") }
}

module.exports = { parseDDMMToISO, isValidTimeHHMM, formatDateISOToDDMM, getNext7DaysRangeISO }
