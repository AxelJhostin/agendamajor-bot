const fs = require("fs")
const path = require("path")
const Database = require("better-sqlite3")

const DATA_DIR = path.resolve(__dirname, "data")
const DB_PATH = path.join(DATA_DIR, "agendamajor.sqlite")

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

  const db = new Database(DB_PATH)
  db.pragma("journal_mode = WAL")

  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      type TEXT NOT NULL,          -- APPOINTMENT | MEDICATION
      title TEXT NOT NULL,
      date TEXT NOT NULL,          -- YYYY-MM-DD
      time TEXT NOT NULL,          -- HH:MM
      frequency TEXT,              -- DIARIO | LUN-MIE-VIE | UNA_VEZ
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reminders_phone_date
    ON reminders(phone, date);

    CREATE TABLE IF NOT EXISTS support_contacts (
      phone TEXT PRIMARY KEY,
      name TEXT,
      contact_phone TEXT,
      updated_at TEXT NOT NULL
    );
  `)

  return db
}

module.exports = { ensureDb }
