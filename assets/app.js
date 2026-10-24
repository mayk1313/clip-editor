/* global YT, ClipScript */
const $ = (id) => document.getElementById(id)
const state = { clips: [], active: -1, player: null, preview: 'original', ending: 'loop', monitor: null }

const safeName = (value, fallback = 'clipe') => {
  const cleaned = String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')
  return cleaned.replace(/^\.+$/, '') || fallback
}
const videoId = (...values) => {
  for (const value of values) {
    const text = String(value || '')
    if (/^[\w-]{11}$/.test(text)) return text
    const match = /(?:v=|youtu\.be\/|\/embed\/|\/live\/)([\w-]{11})/.exec(text)
    if (match) return match[1]
  }
  return ''
}
const seconds = (value) => {
  const raw = String(value ?? '').trim().replace(',', '.')
  if (!raw) return null
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw)
  const parts = raw.split(':').map(Number)
  return parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0) ? null : parts.reduce((total, part) => total * 60 + part, 0)
}
const clock = (value) => {
  const total = Math.max(0, Math.round(Number(value) || 0))
  const h = Math.floor(total / 3600); const m = Math.floor(total % 3600 / 60); const s = total % 60
  return [h, m, s].map((part, index) => index === 0 ? String(part).padStart(2, '0') : String(part).padStart(2, '0')).join(':')
}
const selected = () => state.clips[state.active] || null
const activeRange = () => {
  const clip = selected(); if (!clip) return null
  return state.preview === 'original' ? { start: clip.originalStart, end: clip.originalEnd, label: 'Original' } : { start: clip.start, end: clip.end, label: 'Edição' }
}

function collect(data) {
  const raw = []
  if (Array.isArray(data?.clips)) {
    for (const clip of data.clips) {
      const episode = clip?.episode || {}
      raw.push({ id: clip.id, video: videoId(episode.video_id, episode.live_url, episode.url, clip.live_url), start: clip.clip_start, end: clip.clip_end, season: episode.live_id || clip.season_number || 'temporada', episode: clip.episode_id || episode.id || 'episodio', position: clip.position ?? clip.id, title: clip.cause?.detail || clip.cause?.type || clip.clip_comment || `Clipe ${clip.id}` })
    }
  } else if (data?.dadosGerais) {
    for (const season of data.dadosGerais.temporadas || []) for (const live of season.lives || []) for (const episode of live.episodios || []) for (const [index, death] of (episode.mortes || []).entries()) {
      if (!death?.clipe) continue
      raw.push({ id: death.id || index + 1, video: videoId(episode.videoId, episode.url), start: death.clipe.timestampInicial, end: death.clipe.timestampFinal, season: season.id || 'temporada', episode: episode.id || 'episodio', position: index + 1, title: death.nome || death.id || `Clipe ${index + 1}` })
    }
  }
  const used = new Set()
  return raw.flatMap((item, index) => {
    const start = seconds(item.start), end = seconds(item.end), key = `${item.season}/${item.episode}/${item.position}`
    if (!item.video || start == null || end == null || end <= start || used.has(key)) return []
    used.add(key)
    const name = safeName(`death-${item.position ?? index + 1}`)
    return [{ ...item, index, originalStart: start, originalEnd: end, start, end, name }]
  })
}
function message(text, error = false) { const node = $('import-message'); node.textContent = text; node.className = error ? 'hint form-error' : 'hint' }
function importJson(text) {
  if (!text.trim()) return
  try {
    const clips = collect(JSON.parse(text))
    if (!clips.length) throw new Error('Não encontrei clipes válidos com vídeo, início e fim.')
    state.clips = clips; state.active = 0; $('workspace').hidden = false
    message(`${clips.length} clipes importados. Selecione um da fila para revisar.`)
    renderQueue(); renderEditor(); updateExport()
  } catch (error) { state.clips = []; state.active = -1; $('workspace').hidden = true; message(error.message || 'O arquivo não contém JSON válido.', true) }
}
function ensurePlayer() {
  if (state.player || !window.YT?.Player) return
  state.player = new YT.Player('youtube-player', { width: '100%', height: '100%', playerVars: { playsinline: 1, rel: 0, modestbranding: 1 }, events: { onReady: () => loadSelected(), onStateChange: () => {} } })
}
window.onYouTubeIframeAPIReady = ensurePlayer
function loadSelected() {
  const clip = selected(); if (!clip || !state.player?.loadVideoById) return
  const range = activeRange(); $('player-empty').hidden = true
  state.player.loadVideoById({ videoId: clip.video, startSeconds: range.start })
  startMonitor()
}
function openClip(index) { state.active = index; state.preview = 'original'; $('editor-details').open = true; renderQueue(); renderEditor(); ensurePlayer(); loadSelected() }
function renderQueue() {
  const queue = $('clip-queue'); queue.replaceChildren()
  state.clips.forEach((clip, index) => {
    const item = document.createElement('li'), button = document.createElement('button')
    button.type = 'button'; button.className = `queue-item${index === state.active ? ' active' : ''}`
    button.innerHTML = `<span class="number">${String(index + 1).padStart(2, '0')}</span><span><strong>${clip.name}</strong><small>${clock(clip.start)} → ${clock(clip.end)}</small></span>`
    button.onclick = () => openClip(index); item.append(button); queue.append(item)
  })
  $('queue-count').textContent = `${state.clips.length} ${state.clips.length === 1 ? 'clipe' : 'clipes'}`
  const hasMoreThanOneVideo = new Set(state.clips.map((clip) => clip.video)).size > 1
  $('autoplay-row').hidden = !hasMoreThanOneVideo
  if (!hasMoreThanOneVideo) $('auto-next').checked = false
}
function renderEditor() {
  const clip = selected(); if (!clip) return
  $('cut-title').textContent = clip.title || clip.name
  $('clip-name').value = clip.name; $('clip-start').value = clock(clip.start); $('clip-end').value = clock(clip.end)
  $('original-start').textContent = clock(clip.originalStart); $('original-end').textContent = clock(clip.originalEnd)
  $('edit-error').textContent = ''; updateChanged(); updatePreviewButtons()
}
function updateChanged() {
  const clip = selected(); if (!clip) return
  const changed = clip.name !== safeName(`death-${clip.position}`) || clip.start !== clip.originalStart || clip.end !== clip.originalEnd
  $('changed-badge').hidden = !changed
}
function updateRangeReadout() { const range = activeRange(); if (!range) return; $('range-readout').hidden = false; $('range-kind').textContent = range.label; $('range-time').textContent = `${clock(range.start)} — ${clock(range.end)}` }
function updatePreviewButtons() { $('play-original').classList.toggle('active', state.preview === 'original'); $('play-edited').classList.toggle('active', state.preview === 'edited'); $('mode-loop').classList.toggle('active', state.ending === 'loop'); $('mode-continue').classList.toggle('active', state.ending === 'continue'); updateRangeReadout() }
function applyFields() {
  const clip = selected(); if (!clip) return
  const start = seconds($('clip-start').value), end = seconds($('clip-end').value)
  if (start == null || end == null || end <= start) { $('edit-error').textContent = 'Informe um início e um fim válidos; o fim precisa ser maior.'; return false }
  clip.name = safeName($('clip-name').value, `death-${clip.position}`); clip.start = start; clip.end = end
  $('edit-error').textContent = ''; renderQueue(); updateChanged(); updateRangeReadout(); updateExport(); return true
}
function playRange() { if (!applyFields() || !state.player?.seekTo) return; const range = activeRange(); state.player.seekTo(range.start, true); state.player.playVideo?.(); startMonitor() }
function startMonitor() { window.clearInterval(state.monitor); state.monitor = window.setInterval(() => { const range = activeRange(); if (!range || !state.player?.getCurrentTime) return; if (state.player.getCurrentTime() < range.end) return; if ($('auto-next').checked && state.clips.length > 1) return openClip((state.active + 1) % state.clips.length); if (state.ending === 'loop') { state.player.seekTo(range.start, true); state.player.playVideo?.() } else window.clearInterval(state.monitor) }, 250) }
function capture(field) { const time = state.player?.getCurrentTime?.(); if (!Number.isFinite(time)) return; $(field).value = clock(time); applyFields() }
function updateExport() { $('export-count').textContent = `${state.clips.length} ${state.clips.length === 1 ? 'clipe' : 'clipes'}` }
function outputTasks() {
  const flat = $('flat-output').checked, folder = safeName($('output-folder').value, 'ds1_videos')
  return state.clips.map((clip) => ({ ...clip, path: flat ? [folder, `${safeName(clip.name)}.mp4`] : [safeName(clip.season), safeName(clip.episode), `${safeName(clip.name)}.mp4`] }))
}
function download(name, text) { const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })); const anchor = Object.assign(document.createElement('a'), { href: url, download: name }); anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }

$('json-text').addEventListener('input', (event) => importJson(event.target.value))
$('json-file').addEventListener('change', async (event) => { const file = event.target.files[0]; if (file) { const text = await file.text(); $('json-text').value = text; importJson(text) } event.target.value = '' })
;['clip-name', 'clip-start', 'clip-end'].forEach((id) => $(id).addEventListener('change', applyFields))
$('capture-start').onclick = () => capture('clip-start'); $('capture-end').onclick = () => capture('clip-end')
$('play-original').onclick = () => { state.preview = 'original'; updatePreviewButtons(); playRange() }; $('play-edited').onclick = () => { if (!applyFields()) return; state.preview = 'edited'; updatePreviewButtons(); playRange() }
$('mode-loop').onclick = () => { state.ending = 'loop'; updatePreviewButtons() }; $('mode-continue').onclick = () => { state.ending = 'continue'; updatePreviewButtons() }; $('seek-clip').onclick = playRange
$('editor-details').addEventListener('toggle', () => { if ($('editor-details').open && selected() && !state.player) ensurePlayer() })
$('flat-output').onchange = () => { $('folder-field').hidden = !$('flat-output').checked }; $('folder-field').hidden = true
$('download-sh').onclick = () => download('download-clips.sh', ClipScript.shell(outputTasks(), $('parallel-count').value)); $('download-bat').onclick = () => download('download-clips.bat', ClipScript.batch(outputTasks(), $('parallel-count').value))
if (window.YT?.Player) ensurePlayer()
