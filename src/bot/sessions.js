//src/bot/sessions.js
const sessions = new Map()

function getSession(phone) {
  return sessions.get(phone) || { state: "MENU", data: {}, errors: 0 }
}

function setSession(phone, session) {
  const prev = getSession(phone)
  sessions.set(phone, {
    ...prev,
    ...session,
    data: session.data !== undefined ? session.data : prev.data,
    errors: session.errors !== undefined ? session.errors : prev.errors
  })
}

function incrementErrors(phone) {
  const prev = getSession(phone)
  const next = (prev.errors || 0) + 1
  sessions.set(phone, { ...prev, errors: next })
  return next
}

function resetErrors(phone) {
  const prev = getSession(phone)
  sessions.set(phone, { ...prev, errors: 0 })
}

function resetToMenu(phone) {
  sessions.set(phone, { state: "MENU", data: {}, errors: 0 })
}

module.exports = { getSession, setSession, resetToMenu, incrementErrors, resetErrors }
