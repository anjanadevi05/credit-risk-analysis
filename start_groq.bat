@echo off
echo ===================================================
echo Starting Credit Risk Analysis Servers (GROQ EDITION)...
echo ===================================================
echo This will use Groq API instead of local Ollama.
echo Ensure you have GROQ_API_KEY set in llm_intermediate\.env

echo Starting LLM API Server (Groq)...
start "LLM Evaluation Server" cmd /k "cd llm_intermediate && call venv\Scripts\activate.bat && set PORT=5000 && python llm_groq.py"

echo Waiting for LLM API to boot...
timeout /t 5 /nobreak >nul

echo Starting Backend API...
start "Backend Node Server" cmd /k "cd backend_intermediate && node index.js"

echo Starting Frontend Dev Server...
start "Frontend React app" cmd /k "cd frontend_intermediate && npm run dev"

echo.
echo All services have been launched successfully!
exit
