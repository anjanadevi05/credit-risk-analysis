# Comprehensive Deployment Plan: Credit Risk Analysis Project (Groq Edition)

This document outlines the exact, successfully proven steps to deploy the Credit Risk Analysis project completely for free across modern cloud platforms, completely bypassing the need for heavy local GPU endpoints using Groq API.

## Core Infrastructure

1. **Database:** [Aiven](https://aiven.io/) (Free Managed MySQL)
2. **Node.js Backend:** [Render](https://render.com/) (Web Service)
3. **Python LLM API:** [Render](https://render.com/) (Web Service)
4. **React Frontend:** [Vercel](https://vercel.com/)

---

## 1. Setting up the Cloud Database (Aiven)
We migrated off localhost to a free Aiven MySQL database to permanently store entity data.
1. Create a MySQL Service on Aiven under the *Free Plan*.
2. Copy the Connection Details (`Host`, `User`, `Password`, `Database`, `Port`).
3. To seed it:
   - Add your connection credentials to `backend_intermediate/.env`.
   - Run `node run_aiven_setup.js` from the terminal. 
   - *This command securely creates your schemas and pumps the 50 CSV sample entities directly into your cloud database!*

## 2. Pushing the Main Codebase to GitHub
Render requires a GitHub repository to build its continuous deployment pipeline.
1. Create a new, empty repository on GitHub.
2. Ensure you have the provided `.gitignore` in your root folder so you don't push heavy datasets and sensitive `.env` secrets.
3. Run standard git commands to push:
   ```bash
   git init
   git add .
   git commit -m "Deployment push"
   git branch -M main
   git remote add origin https://github.com/your-username/credit-risk-analysis.git
   git push -u origin main -f
   ```

## 3. Deploying the Node.js API (Render)
1. Go to Render > **New Web Service**.
2. Connect the GitHub repo.
3. **Root Directory:** `backend_intermediate`
4. **Build Command:** `npm install`
5. **Start Command:** `node index.js`
6. **Environment Variables:**
   - `DB_HOST`: mysql-...
   - `DB_USER`: avnadmin
   - `DB_PASSWORD`: [REDACTED]
   - `DB_PORT`: 23722
   - `DB_NAME`: defaultdb
   - `DB_SSL`: true
7. Click Deploy. Upon success, you'll receive a URL like `https://credit-risk-analysis-backend.onrender.com`.

## 4. Deploying the Python LLM Server (Render)
1. Go to Render > **New Web Service**.
2. Connect the exact same GitHub repo.
3. **Root Directory:** `llm_intermediate`
4. **Build Command:** `pip install -r requirements_deployment.txt`
5. **Start Command:** `gunicorn llm_groq:app`
6. **Environment Variables:**
   - `PYTHON_VERSION`: `3.11.0` *(CRITICAL: Fixes pandas compilation errors on Render's Python 3.14 default).*
   - `GROQ_API_KEY`: `gsk_your_api_key_here`
7. Click Deploy. Ensure the health check on `/health` passes. You'll receive a URL like `https://credit-risk-analysis-3w2w.onrender.com`.

## 5. Deploying the React Dashboard (Vercel)
The React dashboard dynamically determines whether you are running locally or in the cloud.
1. Open a terminal inside `frontend_intermediate`.
2. Run `npx vercel` and press **Enter** to accept all default prompts.
3. Once Vercel gives you your project link, go to its Dashboard > **Settings > Environment Variables**.
4. Add the URLs we just built:
   - `VITE_API_BASE_URL` = `https://credit-risk-analysis-backend.onrender.com`
   - `VITE_LLM_URL` = `https://credit-risk-analysis-3w2w.onrender.com`
5. Go to the **Deployments** tab and hit **Redeploy**.

---

### Running the Groq Version Locally
If you want to do testing locally on your own machine without waiting for cloud deployments:
1. Double-click `setup_and_run_groq.bat`.
2. Make sure you have `GROQ_API_KEY` defined inside `llm_intermediate/.env`.
3. It will dynamically start Node, React, and Python, pointing directly to the lightning-fast Groq models. No Ollama installation required!
