/* Local generators: each script downloads only the selected interval. */
const ClipScript = (() => {
  const shQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`
  const batQuote = (value) => `"${String(value).replace(/%/g, '%%').replace(/"/g, "'")}"`

  function shell(tasks, parallel) {
    const jobs = Math.max(1, Math.min(16, Number(parallel) || 4))
    const lines = [
      '#!/usr/bin/env bash', 'set -u', 'export LC_ALL=C', 'cd "$(dirname "$0")" || exit 1',
      `PARALLEL="${'${CLIP_PARALLEL:-' + jobs + '}'}"`, 'case "$PARALLEL" in ""|*[!0-9]*|0) PARALLEL=' + jobs + ';; esac',
      'command -v yt-dlp >/dev/null 2>&1 || { echo "Install yt-dlp before continuing."; exit 1; }',
      'command -v ffmpeg >/dev/null 2>&1 || { echo "Install ffmpeg before continuing."; exit 1; }',
      'TOTAL=' + tasks.length + '; OK=0; SKIP=0; FAIL=0; PIDS=()',
      'cut() { n="$1"; id="$2"; start="$3"; end="$4"; out="$5"; tmp="$out.tmp.mp4"',
      '  if [ -s "$out" ]; then echo "[$n/$TOTAL] already exists: $out"; return 2; fi',
      '  mkdir -p "$(dirname "$out")"; echo "[$n/$TOTAL] downloading $start → $end : $out"',
      '  yt-dlp --no-playlist --force-overwrites --retries 5 --fragment-retries 5 --download-sections "*$start-$end" --force-keyframes-at-cuts -f "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b" --merge-output-format mp4 -o "$tmp" "https://www.youtube.com/watch?v=$id"',
      '  if [ $? -eq 0 ] && [ -s "$tmp" ] && ffmpeg -hide_banner -loglevel error -y -i "$tmp" -c:v libx264 -crf 28 -preset medium -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart "$out.part"; then mv "$out.part" "$out"; rm -f "$tmp" "$tmp.part"; return 0; fi',
      '  echo "  FAILED"; rm -f "$out.part" "$tmp" "$tmp.part"; return 1; }',
      'collect() { for pid in "${PIDS[@]}"; do wait "$pid"; case $? in 0) OK=$((OK+1));; 2) SKIP=$((SKIP+1));; *) FAIL=$((FAIL+1));; esac; done; PIDS=(); }',
      'echo "Downloading $TOTAL clips ($PARALLEL in parallel)"',
    ]
    tasks.forEach((task, index) => { lines.push(`cut ${[index + 1, task.video, task.start, task.end, task.path.join('/')].map(shQuote).join(' ')} &`, 'PIDS+=($!)', 'if [ "${#PIDS[@]}" -ge "$PARALLEL" ]; then collect; fi') })
    lines.push('collect', 'echo "Finished: $OK downloaded, $SKIP already existed, $FAIL failed."', 'exit "$FAIL"')
    return `${lines.join('\n')}\n`
  }

  function batch(tasks, parallel) {
    const jobs = Math.max(1, Math.min(16, Number(parallel) || 4))
    const lines = [
      '@echo off', 'setlocal EnableExtensions EnableDelayedExpansion', 'cd /d "%~dp0"', 'if /i "%~1"==":job" goto job',
      'where yt-dlp >nul 2>&1 || (echo Install yt-dlp before continuing.& pause & exit /b 1)', 'where ffmpeg >nul 2>&1 || (echo Install ffmpeg before continuing.& pause & exit /b 1)',
      `set "PARALLEL=${jobs}"`, 'if defined CLIP_PARALLEL set "PARALLEL=%CLIP_PARALLEL%"', 'set /a RUNNING=0,OK=0,SKIP=0,FAIL=0', `set "TOTAL=${tasks.length}"`,
      'if not exist ".clip-jobs" mkdir ".clip-jobs"', 'del /q ".clip-jobs\\*.status" ".clip-jobs\\*.tmp" >nul 2>&1', 'echo Downloading %TOTAL% clips (%PARALLEL% in parallel)',
    ]
    tasks.forEach((task, index) => lines.push(`call :start ${[index + 1, task.video, task.start, task.end, task.path.join('\\')].map(batQuote).join(' ')}`))
    lines.push(
      'call :waitall', 'echo.', 'echo Finished: %OK% downloaded, %SKIP% already existed, %FAIL% failed.', 'pause', 'exit /b %FAIL%',
      ':start', 'start "" /b cmd /c call "%~f0" :job "%~1" "%~2" "%~3" "%~4" "%~5"', 'set /a RUNNING+=1', ':slot', 'if !RUNNING! LSS !PARALLEL! exit /b 0', 'call :reap', 'if !RUNNING! GEQ !PARALLEL! timeout /t 1 /nobreak >nul & goto slot', 'exit /b 0',
      ':waitall', 'if !RUNNING! LEQ 0 exit /b 0', 'call :reap', 'if !RUNNING! GTR 0 timeout /t 1 /nobreak >nul & goto waitall', 'exit /b 0',
      ':reap', 'for %%F in (".clip-jobs\\*.status") do if exist "%%~fF" (set "R=" & set /p R=<"%%~fF" & if "!R!"=="0" set /a OK+=1 & if "!R!"=="2" set /a SKIP+=1 & if not "!R!"=="0" if not "!R!"=="2" set /a FAIL+=1 & del "%%~fF" & set /a RUNNING-=1)', 'exit /b 0',
      ':job', 'set "N=%~2"', 'set "V=%~3"', 'set "S=%~4"', 'set "E=%~5"', 'set "P=%~6"', 'if exist "%P%" for %%F in ("%P%") do if %%~zF GTR 0 (set "R=2" & goto done)', 'for %%D in ("%P%") do if not exist "%%~dpD" mkdir "%%~dpD"', 'echo [%N%/%TOTAL%] %S% - %E% : %P%', 'yt-dlp --no-playlist --force-overwrites --retries 5 --fragment-retries 5 --download-sections "*%S%-%E%" --force-keyframes-at-cuts -f "bv*[height^<=1080]+ba/b[height^<=1080]/bv*+ba/b" --merge-output-format mp4 -o "%P%.tmp.mp4" "https://www.youtube.com/watch?v=%V%"', 'if errorlevel 1 (set "R=1" & goto clean)', 'ffmpeg -hide_banner -loglevel error -y -i "%P%.tmp.mp4" -c:v libx264 -crf 28 -preset medium -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart "%P%.part"', 'if errorlevel 1 (set "R=1" & goto clean)', 'move /y "%P%.part" "%P%" >nul', 'set "R=0"', ':clean', 'if exist "%P%.part" del "%P%.part"', 'if exist "%P%.tmp.mp4" del "%P%.tmp.mp4"', ':done', '> ".clip-jobs\!N!.tmp" echo !R!', 'move /y ".clip-jobs\!N!.tmp" ".clip-jobs\!N!.status" >nul', 'exit /b !R!'
    )
    return `${lines.join('\r\n')}\r\n`
  }
  return { shell, batch }
})()
