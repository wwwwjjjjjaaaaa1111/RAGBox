@echo off
setlocal enabledelayedexpansion
title AI-CHAT-RAG Launcher
cd /d "%~dp0"

echo ============================================
echo    AI-CHAT-RAG one-click launcher
echo ============================================
echo.

if defined RAG_DRYRUN (
  echo [dry-run] structure ok - nothing was installed or started.
  exit /b 0
)

rem ---------- 0) tool checks ----------
where node >nul 2>nul
if errorlevel 1 (
  echo [x] Node.js not found. Please install it first: https://nodejs.org
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo [x] npm not found - it is bundled with Node.js.
  pause
  exit /b 1
)

rem ---------- 1) create missing .env files ----------
if not exist "backend-server\.env" (
  if exist "backend-server\.env.example" (
    copy /y "backend-server\.env.example" "backend-server\.env" >nul
    echo [i] created backend-server\.env
  )
)
if not exist "AI-server\.env" (
  if exist "AI-server\.env.example" (
    copy /y "AI-server\.env.example" "AI-server\.env" >nul
    echo [i] created AI-server\.env - fill API keys when needed
  )
)
if not exist "client\.env" (
  if exist "client\.env.example" (
    copy /y "client\.env.example" "client\.env" >nul
    echo [i] created client\.env
  )
)

rem ---------- 2) backend-server deps + database ----------
if not exist "backend-server\node_modules" (
  echo [i] installing backend-server dependencies...
  pushd backend-server
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    popd
    echo [x] backend-server install failed.
    pause
    exit /b 1
  )
  call npx prisma generate
  popd
)
if not exist "backend-server\prisma\dev.db" (
  echo [i] initializing database - applying migrations...
  pushd backend-server
  call npx prisma migrate deploy
  if errorlevel 1 (
    popd
    echo [x] database init failed. Check DATABASE_URL.
    pause
    exit /b 1
  )
  popd
)

rem ---------- 3) client deps ----------
if not exist "client\node_modules" (
  echo [i] installing client dependencies...
  pushd client
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    popd
    echo [x] client install failed.
    pause
    exit /b 1
  )
  popd
)

rem ---------- 4) AI-server python (conda env LCenv) ----------
set "CONDA_ENV=LCenv"
set "AI_PY="

if defined AI_SERVER_PYTHON (
  if exist "%AI_SERVER_PYTHON%" set "AI_PY=%AI_SERVER_PYTHON%"
)

if not defined AI_PY (
  for /f "delims=" %%i in ('conda info --base 2^>nul') do (
    if exist "%%i\envs\%CONDA_ENV%\python.exe" set "AI_PY=%%i\envs\%CONDA_ENV%\python.exe"
  )
)

if not defined AI_PY (
  for %%R in ("D:\anaconda" "%ProgramData%\Anaconda3" "%ProgramData%\miniconda3" "%LOCALAPPDATA%\anaconda3" "%LOCALAPPDATA%\miniconda3" "%USERPROFILE%\anaconda3" "%USERPROFILE%\miniconda3") do (
    if exist "%%~R\envs\%CONDA_ENV%\python.exe" set "AI_PY=%%~R\envs\%CONDA_ENV%\python.exe"
  )
)

if not defined AI_PY (
  echo [x] Python of conda env "%CONDA_ENV%" was not found.
  echo     Install Anaconda/Miniconda and create the "%CONDA_ENV%" env,
  echo     or point env var AI_SERVER_PYTHON to the env python and retry.
  pause
  exit /b 1
)

echo [i] AI-server python: !AI_PY!

rem Auto-install AI deps when the resolved env python is missing them.
"!AI_PY!" -c "import fastapi,uvicorn,httpx,dotenv,chromadb,langchain_core,langchain_community,langchain_chroma,langchain_openai,langchain_text_splitters,zhipuai" >nul 2>nul
if errorlevel 1 (
  echo [i] AI-server deps missing, installing... may take a few minutes the first time.
  "!AI_PY!" -m pip install -r "%~dp0AI-server\requirements.txt"
  if errorlevel 1 (
    echo [x] AI-server deps install failed. Check your network and retry.
    pause
    exit /b 1
  )
)

rem ---------- 5) start the three services ----------
echo.
echo [i] Starting three service windows...

start "backend-server :3001" cmd /k "cd /d ""%~dp0backend-server"" && npm run dev"
start "AI-server :8000" cmd /k "cd /d ""%~dp0AI-server"" && ""!AI_PY!"" main.py"
start "client :5173" cmd /k "cd /d ""%~dp0client"" && npm run dev"

echo.
echo ============================================
echo   URLs:
echo     Frontend     http://localhost:5173
echo     Backend      http://127.0.0.1:3001/health
echo     AI server    http://127.0.0.1:8000/health
echo.
echo   Register an account on first use, then sign in.
echo   Close a service window to stop it, or run stop-all.bat.
echo ============================================
pause
