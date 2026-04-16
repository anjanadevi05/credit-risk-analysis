@echo off
echo ===================================================
echo Starting Credit Risk Analysis Servers...
echo ===================================================
echo Postman / curl samples: POSTMAN.md
echo Favicon: frontend_intermediate\public\logo.png ^(transparent: python tools\make_logo_transparent.py ...^)
echo Flow: API (score) ^> VectorDB+RAG ^> LLM (summary)
echo LLM / Ollama settings: edit llm_intermediate\.env ^(copy from .env.example^)

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

echo Refreshing vector index (safe to run anytime, with retries)...
powershell -Command "$ok=$false; for ($i=0; $i -lt 6; $i++) { try { $r = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:5000/rag/reindex' -TimeoutSec 300; Write-Host 'Reindex OK:' ($r | ConvertTo-Json -Compress); $ok=$true; break } catch { Write-Host ('Reindex attempt ' + ($i+1) + ' failed: ' + $_.Exception.Message); Start-Sleep -Seconds 5 } }; if (-not $ok) { Write-Host 'Reindex failed after retries. Fix: run Ollama, then restart LLM server (it auto-reindexes on startup) or POST http://127.0.0.1:5000/rag/reindex' }"

echo Starting Backend API...
start "Backend Node Server" cmd /k "cd backend_intermediate && npm start"

echo Starting Frontend Dev Server...
start "Frontend React app" cmd /k "cd frontend_intermediate && npm run dev"

echo.
echo All services have been launched successfully!
echo Optional thesis tool: run_summary_metrics.bat ^(BLEU/ROUGE vs references.jsonl — not part of live app^)
exit
