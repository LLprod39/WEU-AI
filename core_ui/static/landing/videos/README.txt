Видео для лендинга (welcome): автоплей без плеера в окошках.

ВАЖНО: В браузерах (Chrome, Firefox и др.) надёжно показывается только MP4.
MKV часто не воспроизводится — нужна конвертация в MP4.

Положите в эту папку 4 файла в формате MP4:
  - agent.mp4   (демо агентов)
  - mcp.mp4     (демо MCP)
  - server.mp4  (демо серверов/терминала)
  - task.mp4    (демо тасков)

Папка: c:\work_ai\agent_projects\web_rA\core_ui\static\landing\videos\

Конвертация MKV -> MP4 (одной командой в папке с .mkv, потом скопировать .mp4 сюда):
  ffmpeg -i agent.mkv -c:v libx264 -an -movflags +faststart agent.mp4
  ffmpeg -i MCP.mkv   -c:v libx264 -an -movflags +faststart mcp.mp4
  ffmpeg -i server.mkv -c:v libx264 -an -movflags +faststart server.mp4
  ffmpeg -i task.mkv  -c:v libx264 -an -movflags +faststart task.mp4

После добавления .mp4 обновите страницу http://127.0.0.1:9000/welcome/
