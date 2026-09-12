@echo off
setlocal enabledelayedexpansion
title RAGBox Launcher
cd /d "%~dp0"

echo ============================================
echo    RAGBox one-click launcher
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
where docker >nul 2>nul
if errorlevel 1 (
  echo [x] Docker not found - PostgreSQL/Qdrant infrastructure runs on it.
  pause
  exit /b 1
)
docker info >nul 2>nul
if errorlevel 1 (
  echo [x] Docker daemon is not running. Start Docker Desktop first.
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
    echo [i] created AI-server\.env - fill embedding API keys when needed
  )
)
if not exist "client\.env" (
  if exist "client\.env.example" (
    copy /y "client\.env.example" "client\.env" >nul
    echo [i] created client\.env
  )
)

rem ---------- 2) infrastructure containers ----------
echo [i] starting infrastructure containers (postgres / qdrant / prometheus / grafana)...
docker compose up -d postgres qdrant prometheus grafana
if errorlevel 1 (
  echo [x] infrastructure containers failed to start.
  pause
  exit /b 1
)

echo [i] waiting for PostgreSQL to become healthy...
set /a TRIES=0
:wait_pg
docker inspect --format "{{.State.Health.Status}}" ragbox-postgres 2>nul | findstr healthy >nul
if errorlevel 1 (
  set /a TRIES+=1
  if !TRIES! GEQ 30 (
    echo [x] PostgreSQL not healthy after 150 seconds.
    pause
    exit /b 1
  )
  timeout /t 5 /nobreak >nul
  goto wait_pg
)
echo [i] PostgreSQL healthy.

rem ---------- 3) backend-server deps + database schema ----------
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
echo [i] syncing database schema (idempotent)...
pushd backend-server
call npx prisma migrate deploy
if errorlevel 1 (
  popd
  echo [x] database migration failed. Check DATABASE_URL and PostgreSQL status.
  pause
  exit /b 1
)
popd

rem ---------- 4) client deps ----------
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

rem ---------- 5) AI-server python (conda env LCenv) ----------
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
"!AI_PY!" -c "import fastapi,uvicorn,httpx,dotenv,langchain_core,langchain_community,langchain_openai,langchain_text_splitters,langchain_qdrant,qdrant_client,prometheus_client,matplotlib,zhipuai" >nul 2>nul
if errorlevel 1 (
  echo [i] AI-server deps missing, installing... may take a few minutes the first time.
  "!AI_PY!" -m pip install -r "%~dp0AI-server\requirements.txt"
  if errorlevel 1 (
    echo [x] AI-server deps install failed. Check your network and retry.
    pause
    exit /b 1
  )
)

rem ---------- 6) start the three app services ----------
echo.
echo [i] Starting three app service windows...

start "backend-server :3001" cmd /k "cd /d ""%~dp0backend-server"" && npm run dev"
start "AI-server :8000" cmd /k "cd /d ""%~dp0AI-server"" && ""!AI_PY!"" main.py"
start "client :5173" cmd /k "cd /d ""%~dp0client"" && npm run dev"

echo.
echo ============================================
echo   URLs:
echo     Frontend     http://localhost:5173
echo     Backend      http://127.0.0.1:3001/health
echo     AI server    http://127.0.0.1:8000/health
echo     Grafana      http://127.0.0.1:3000 (admin / ragbox-dev-password)
echo     Prometheus   http://127.0.0.1:9090
echo.
echo   Register an account on first use, then sign in.
echo   Infrastructure containers keep running; stop apps with close
echo   windows or stop-all.bat, containers via docker compose stop.
echo ============================================
pause
