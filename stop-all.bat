@echo off
title AI-CHAT-RAG Stopper

echo Stopping processes listening on ports 3001 / 8000 / 5173...

for %%P in (3001 8000 5173) do (
  for /f "tokens=5" %%a in ('netstat -ano -p tcp ^| findstr /r /c:":%%P .*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>nul && echo   stopped PID %%a on port %%P
  )
)

echo.
echo Done. If any service windows remain, close them manually.
pause
