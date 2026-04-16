# Comprehensive Deployment Plan: Credit Risk Analysis Project (Groq Edition)

To deploy your Credit Risk Analysis project and make it fully functional and **fast** over the internet, we have restructured the Python LLM server to use the **Groq API** instead of local Ollama. This means you do not need expensive GPU cloud servers anymore.

We need to handle four distinct components:

1. **Frontend (React / Vite)**
2. **Backend (Node.js / Express)**
3. **Database (MySQL)**
4. **LLM Server (Python / Flask / Groq API)**

Because your project now uses Groq APIs for Large Language Models, all components can easily be hosted on standard free-tier or very cheap hosting platforms!

---

## The Cloud PaaS Approach (Free / Low Cost)
This approach places all parts onto easily manageable cloud platforms.

### 1. Database -> Managed MySQL (Aiven, Render, or Railway)
It's highly recommended to use a managed database rather than hosting it yourself to prevent data corruption.
*   **Steps:**
    1. Go to a provider like [Railway.app](https://railway.app), [Aiven.io](https://aiven.io) or [Render](https://render.com) and create a "MySQL Database".
    2. Once created, they will give you a **Connection URL** or credentials (`Host`, `User`, `Password`, `Database`, `Port`).
    3. Run your local `import_csv_to_db.js` pointing to this new cloud database to seed your data.

### 2. Node.js Backend -> Render or Railway 
Your Express backend handles the API routing and SQL interaction.
*   **Steps:**
    1. Push `backend_intermediate` to GitHub.
    2. Go to [Render.com](https://render.com) and create a "Web Service."
    3. Point it to your GitHub repo and set the root directory to `backend_intermediate`.
    4. Set the build command to `npm install` and start command to `npm start` (make sure you add `"start": "node index.js"` to your `package.json`).
    5. Add your MySQL Database credentials to the Environment Variables block.
    6. Deploy. You'll get a URL like `https://credit-backend.onrender.com`.

### 3. LLM Server (Python + Groq) -> Render or Heroku
Because we switched from local Ollama to Groq, you no longer need an expensive GPU server.
*   **Steps:**
    1. Your new files (`llm_groq.py`, `rag_groq.py`, and `requirements_deployment.txt`) are already in `llm_intermediate`.
    2. Push `llm_intermediate` to GitHub.
    3. Go to [Render.com](https://render.com) and create a "Web Service."
    4. Set the root directory to `llm_intermediate`.
    5. Set the build command to `pip install -r requirements_deployment.txt`.
    6. Set the start command to: `gunicorn llm_groq:app`
    7. **CRITICAL:** Add an Environment Variable named `GROQ_API_KEY` and set it to your Groq API key (You can get a free one from [console.groq.com](https://console.groq.com)).
    8. Deploy! You will get a URL like `https://credit-llm.onrender.com`.

### 4. Frontend (React / Vite) -> Vercel or Netlify (Free)
Platforms like Vercel and Netlify are optimized for React applications and offer fantastic free tiers.
*   **Steps:**
    1. Push your `frontend_intermediate` code to a GitHub repository.
    2. Log into [Vercel](https://vercel.com) and click "Add New Project."
    3. Import your GitHub repository.
    4. Override the root directory to `frontend_intermediate`.
    5. Vercel will automatically detect Vite and run `npm run build`.
    6. Add your new deployed backend URLs as Environment Variables (e.g., `VITE_API_BASE_URL=https://credit-backend.onrender.com` / `VITE_LLM_URL=https://credit-llm.onrender.com`).
    7. Deploy! Your UI will be served immediately.

## Final Checklist Before Deployment
Before pushing your code to any platform, ensure:
1. **Groq API Key:** Ensure you have registered on Groq and obtained your free `GROQ_API_KEY`.
2. **Dynamic Ports:** the Node.js config is already set to `app.listen(process.env.PORT || 3000)`. Python is set up via Gunicorn to handle dynamic ports smoothly.
3. **Run Locally First (Optional):** If you want to test the new Groq deployment code locally, just `cd llm_intermediate`, `pip install -r requirements_deployment.txt`, add `GROQ_API_KEY=your_key` to your `.env` file, and run `python llm_groq.py`.
