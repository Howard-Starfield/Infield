/**
 * One-off sync: copy workspace.sidenotes + workspace save strings from EN to all locales.
 * Run from repo root: node scripts/sync-sidenote-i18n.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const localesDir = path.join(__dirname, '..', 'src', 'i18n', 'locales')
const enPath = path.join(localesDir, 'en', 'translation.json')
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'))
const sidenotes = en.workspace.sidenotes
const topKeys = ['saving', 'saved', 'saveFailed', 'saveFailedShort', 'pillUpdated', 'pillWords', 'aiPlaceholder']

for (const lang of fs.readdirSync(localesDir)) {
  if (lang === 'en') continue
  const p = path.join(localesDir, lang, 'translation.json')
  if (!fs.existsSync(p)) continue
  const j = JSON.parse(fs.readFileSync(p, 'utf8'))
  j.workspace = j.workspace || {}
  j.workspace.sidenotes = { ...sidenotes }
  for (const k of topKeys) {
    if (en.workspace[k] != null) j.workspace[k] = en.workspace[k]
  }
  fs.writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`)
}

console.log('Synced workspace.sidenotes + save strings to all non-en locales.')
