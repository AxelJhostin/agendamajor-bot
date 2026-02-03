// src/db/index.js
const dayjs = require("dayjs")
const { ensureDb } = require("../../db") // usa tu db.js actual

const db = ensureDb()

const insertReminderStmt = db.prepare(`
  INSERT INTO reminders (phone, type, title, date, time, frequency, created_at)
  VALUES (@phone, @type, @title, @date, @time, @frequency, @created_at)
`)

const selectTodayStmt = db.prepare(`
  SELECT id, type, title, date, time, frequency
  FROM reminders
  WHERE phone = ? AND date = ?
  ORDER BY time ASC
`)

const selectRangeStmt = db.prepare(`
  SELECT id, type, title, date, time, frequency
  FROM reminders
  WHERE phone = ? AND date BETWEEN ? AND ?
  ORDER BY date ASC, time ASC
`)

const upsertSupportContactStmt = db.prepare(`
  INSERT INTO support_contacts (phone, name, contact_phone, updated_at)
  VALUES (@phone, @name, @contact_phone, @updated_at)
  ON CONFLICT(phone) DO UPDATE SET
    name = excluded.name,
    contact_phone = excluded.contact_phone,
    updated_at = excluded.updated_at
`)

const selectSupportContactStmt = db.prepare(`
  SELECT phone, name, contact_phone, updated_at
  FROM support_contacts
  WHERE phone = ?
`)

function insertReminder({ phone, type, title, date, time, frequency }) {
  insertReminderStmt.run({
    phone,
    type,
    title,
    date,
    time,
    frequency: frequency || null,
    created_at: dayjs().toISOString()
  })
}

function getToday(phone, dateISO) {
  return selectTodayStmt.all(phone, dateISO)
}

function getRange(phone, startISO, endISO) {
  return selectRangeStmt.all(phone, startISO, endISO)
}

function upsertSupportContact({ phone, name, contactPhone }) {
  upsertSupportContactStmt.run({
    phone,
    name,
    contact_phone: contactPhone,
    updated_at: dayjs().toISOString()
  })
}

function getSupportContact(phone) {
  return selectSupportContactStmt.get(phone)
}

module.exports = { insertReminder, getToday, getRange, upsertSupportContact, getSupportContact }
