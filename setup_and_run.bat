@echo off
echo ===================================================
echo Setting up Credit Risk Analysis Project...
echo ===================================================
echo App name: Credit Risk Analysis ^(browser tab / favicon: frontend_intermediate\public\logo.png^)
echo API samples for Postman: POSTMAN.md in repo root
echo Flow: API (score) ^> VectorDB+RAG ^> LLM (summary)
echo LLM / Ollama settings: edit llm_intermediate\.env ^(copy from .env.example^)

echo.
echo [1/3] Setting up Backend...
cd backend_intermediate
call npm install
cd ..

echo.
echo [2/3] Setting up Frontend...
cd frontend_intermediate
call npm install
cd ..

echo.
echo [3/3] Setting up Python Environment for LLM API...
cd llm_intermediate
if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)
call venv\Scripts\activate.bat
echo Installing python dependencies...
pip install -r requirements.txt
pip install -r requirements_deployment.txt
cd ..

echo.
echo ===================================================
echo All dependencies installed! Starting Services...
echo ===================================================

echo Starting Ollama serve (if ollama is on PATH)...
where ollama >nul 2>&1
if %ERRORLEVEL% equ 0 (
  start "Ollama" /MIN cmd /k "ollama serve"
  timeout /t 4 /nobreak >nul
) else (
  echo [Note] ollama not in PATH — start the Ollama desktop app if you use embedding models.
)

echo Starting LLM API Server...
start "LLM Evaluation Server" cmd /k "cd llm_intermediate && call venv\Scripts\activate.bat && python llm.py"

echo Waiting for LLM API to boot...
timeout /t 15 /nobreak >nul

echo Building vector index (RAG) with retries...
powershell -Command "$ok=$false; for ($i=0; $i -lt 6; $i++) { try { $r = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:5000/rag/reindex' -TimeoutSec 300; Write-Host 'Reindex OK:' ($r | ConvertTo-Json -Compress); $ok=$true; break } catch { Write-Host ('Reindex attempt ' + ($i+1) + ' failed: ' + $_.Exception.Message); Start-Sleep -Seconds 5 } }; if (-not $ok) { Write-Host 'Reindex failed after retries. The LLM server also reindexes automatically a few seconds after start; check Ollama and delete llm_intermediate/vector_store if the store is corrupt.' }"

echo Starting Backend API...
start "Backend Node Server" cmd /k "cd backend_intermediate && npm start"

echo Starting Frontend Dev Server...
start "Frontend React app" cmd /k "cd frontend_intermediate && npm run dev"

echo.
echo All services have been launched in separate windows!
echo Optional: run_summary_metrics.bat for BLEU/ROUGE on saved eval JSON ^(separate from app runtime^).
echo Make sure MySQL and Ollama are running.
echo Required Ollama models:
echo   - mistral (LLM summary)
echo   - nomic-embed-text (RAG embeddings)
pause
