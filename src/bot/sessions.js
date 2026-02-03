const sessions = new Map()

function getSession(phone) {
  return sessions.get(phone) || { state: "MENU", data: {} }
}

function setSession(phone, session) {
  sessions.set(phone, session)
}

function resetToMenu(phone) {
  sessions.set(phone, { state: "MENU", data: {} })
}

module.exports = { getSession, setSession, resetToMenu }
