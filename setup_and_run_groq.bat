@echo off
echo ===================================================
echo Setting up Credit Risk Analysis Project (GROQ CLOUD EDITION)...
echo ===================================================
echo This will install all dependencies and start the app using
echo the blazing fast Groq API instead of the slow local Ollama server!

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
echo Installing lightweight production dependencies...
pip install -r requirements_deployment.txt
cd ..

echo.
echo ===================================================
echo All dependencies installed! Starting Services...
echo ===================================================

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
pause
