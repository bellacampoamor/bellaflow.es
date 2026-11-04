// Zet de single-file build om naar de vorm die een gepubliceerde preview verwacht:
// alleen de inhoud, zonder doctype/html/head/body.
import { readFileSync, writeFileSync } from 'node:fs'
let html = readFileSync('dist-preview/index.html', 'utf8')
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'))
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
const clean = head.replace(/<meta charset[^>]*>/, '').replace(/<meta name="viewport"[^>]*>/, '')
const scripts = []
const noScripts = clean.replace(/<script[\s\S]*?<\/script>/g, (m) => { scripts.push(m); return '' })
const titleFirst = noScripts.trim()
writeFileSync('dist-preview/bella-flow.html', `${titleFirst}\n${body}\n${scripts.join('\n')}\n`)
