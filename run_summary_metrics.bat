@echo off
echo ===================================================
echo Optional: BLEU / ROUGE summary metrics (thesis / research)
echo Live API / Postman examples: POSTMAN.md (repo root)
echo Requires: pip install sacrebleu rouge-score
echo Add reference lines to llm_intermediate\results\references.jsonl first.
echo ===================================================
cd /d "%~dp0llm_intermediate"
if not exist "venv\Scripts\activate.bat" (
  echo [Error] venv not found. Run setup_and_run.bat once to create it.
  pause
  exit /b 1
)
call venv\Scripts\activate.bat
pip install sacrebleu rouge-score -q
python tools\evaluate_summaries.py
echo.
echo Done. See llm_intermediate\results\summary_metrics_report.json
echo ^(ROUGE/BLEU gauge-vs-memorandum; add references.jsonl for gold BLEU/ROUGE — accuracy/confidence omitted from report^)
pause
