# MetaDock

## AI Agent (Adaptive RAG System)

MetaDock includes an intelligent AI agent powered by an **Adaptive RAG (Retrieval-Augmented Generation)** system designed to assist with bioinformatics tool-related questions.

### 🚀 New Features

-   **Adaptive Query Routing**: Automatically determines whether to use local knowledge base, web search, or general LLM based on the question type
-   **Intelligent Document Retrieval**: Advanced scoring system to evaluate document relevance  
-   **Hallucination Detection**: Verifies that generated answers are grounded in factual documentation
-   **Self-Correcting System**: Automatically retries and optimizes queries for better results
-   **Fast Startup**: Pre-built vector database allows for quick initialization (seconds instead of minutes)
-   **Incremental Updates**: Only re-processes documents when changes are detected

### 💬 User Interface

-   **Conversational Interface**: A draggable and resizable chat widget provides a user-friendly way to interact with the agent
-   **Streaming Responses**: Get real-time, token-by-token responses for a fast and interactive experience
-   **Markdown Support**: Responses are rendered in Markdown for clear and structured formatting of text, code blocks, and lists
-   **Persistent Chat History**: The conversation, as well as the widget's position and size, are saved in the browser's local storage
-   **Source References**: Shows which documents were used to generate answers for transparency

### 🏗️ Architecture

The agent system consists of:
- **Document Processor**: Offline processing of help documents into vector embeddings
- **Adaptive RAG Engine**: Smart retrieval and generation system with multiple quality checks
- **Flask API Server**: RESTful interface for real-time communication
- **Automatic Integration**: Seamlessly started by the main Node.js server

The agent is powered by a Python backend using Flask, LangChain, and FAISS, which is automatically started by the main server.

## Project layout

- **backend-node/** – Node server: `server.js`, `handlers/`, `config/` (tools, visualization, index), `admin/` (routes, controllers, services, views, scripts, data).
- **backend-agent/** – Python agent:
  - **core/** – `adaptive_rag.py`, `bioinfo_agent.py`, `workflow_planner.py`, `session_memory.py`, `spades_quast_kg.py`
  - **infra/** – `agent_client.py`, `document_processor.py`
  - **api/** – `agent_server.py`
  - **prompts/** – YAML prompts (routing, grading, rag_general, etc.)
  - `config.py`, `prompt_loader.py`
- **frontend/** – `public/` (static, views), `components/`.
- **data/** – `help_pages_for_test/`, `parameters/`, `spades_quast_kg.json`, `custom_workflows.json`.
- **evals/** – `datasets/`, `scripts/` for RAG and workflow evaluation.
- **tests/** – Unit and integration tests.
- **docs/** – `architecture.md`, `evaluation-guide.md`, `prompt-assets.md`, `handover-runbook.md`.

Configure project-root `.env` and set `REMOTE_WORKDIR` plus API keys. See `docs/handover-runbook.md` for a short handover list.

## Quick Run

1. **Install dependencies** from project root:
   - `npm install`
   - `python -m venv .venv`
   - activate venv, then `pip install -r requirements.txt`
2. **Configure environment**:
   - Copy `.env.example` to `.env`
   - Fill your local values in `.env` (`REMOTE_WORKDIR`, API keys, etc.)
   - Never commit `.env` (secrets must stay local)
3. **Optional vector store build** (first-time RAG setup):
   - `python backend-agent/infra/document_processor.py`
4. **Start application**:
   - `npm start` (or `node backend-node/server.js`)
   - Node starts the Python agent automatically (`backend-agent/api/agent_server.py`)
   - Open `http://localhost:3000` (or `PORT` in `.env`)

Node-only startup (same entrypoint script): `npm run start:backend`  
Manual agent startup: `python backend-agent/api/agent_server.py`

## Documentation Site (MkDocs)

Run from project root:

```shell
pip install mkdocs mkdocs-material
mkdocs serve
```

Open: [http://127.0.0.1:8000](http://127.0.0.1:8000)

Published docs (GitHub Pages): [https://MetaDock.github.io/MetaDock_dv/](https://MetaDock.github.io/MetaDock_dv/)

## Setup and Installation

1.  **Clone the repository**
    ```shell
    git clone git@github.com:MetaDock/MetaDock_dv.git
    cd MetaDock
    ```

2.  **Create a Python virtual environment**
    ```shell
    python -m venv .venv
    ```

3.  **Activate the virtual environment**
    -   On Windows:
        ```shell
        .venv\Scripts\activate
        ```
    -   On macOS or Linux:
        ```shell
        source .venv/bin/activate
        ```

4.  **Install dependencies**
    Install both the Node.js and Python packages:
    ```shell
    npm install
    pip install -r requirements.txt
    ```

5.  **Configure Environment Variables**
    Copy `.env.example` to `.env` in the project root directory (`MetaDock_dv/.env`), then set your local API keys and runtime paths.
    
    ```env
    # AI Model API Keys
    # Qwen API Configuration
    DASHSCOPE_API_KEY=your_dashscope_api_key_here
    
    # Gemini API Configuration
    # GEMINI_API_KEY=your_gemini_api_key_here
    
    # Ollama Configuration
    # OLLAMA_HOST=http://localhost:11434
    
    # Server Configuration
    # PORT=3010
    # NODE_ENV=development
    
    # SSH Configuration
    # SSH_HOST=localhost
    # SSH_PORT=22
    # SSH_USER=root
    # SSH_PASSWORD=
    # SSH_KEY=/path/to/your/private/key
    ```
    
    **Note:** 
    - ✅ **Now supports `.env` file** - All environment variables are automatically loaded from `.env` file
    - Start from `.env.example`; keep real secrets only in local `.env`
    - Do not commit `.env` to Git; if a secret is accidentally exposed, rotate it immediately
    - At least one API key (Qwen or Gemini) is required for the AI agent to work
    - Users can also input their API keys through the web interface after starting the application
    - Get Qwen API key at: https://dashscope.console.aliyun.com/
    - Get Gemini API key at: https://aistudio.google.com/apikey
    - For Gemini, also install: `pip install google-genai`

6.  **Initialize the AI Agent Vector Database (First Time Only)**
    Build the vector database for document retrieval (run from project root):
    ```shell
    python backend-agent/infra/document_processor.py
    ```
    Or with backend-agent on `PYTHONPATH`: `PYTHONPATH=backend-agent python -c "from infra.document_processor import DocumentProcessor; DocumentProcessor().build_vector_store()"`
    
    This step:
    - ✅ Processes 12 bioinformatics tool documents from `help_pages_for_test/`
    - ✅ Builds FAISS vector database for fast semantic search
    - ✅ Generates metadata for the knowledge base
    - ⏱️ Takes approximately 1-2 minutes on first run
    - 🔄 Automatically detects and updates only changed documents on subsequent runs

7.  **Start the application**
    From project root. This launches the Node server (backend-node) and starts the Python agent (backend-agent/api/agent_server.py):
    ```shell
    npm start
    ```
    or `node backend-node/server.js`.

8.  **Access the application**
    Open your browser and navigate to [http://localhost:3000](http://localhost:3000) (or `PORT` in `.env`).

## 🔧 Agent System Maintenance

### Updating Documents
When you add or modify files in `data/help_pages_for_test/`, update the vector database:
```shell
PYTHONPATH=backend-agent python -c "from infra.document_processor import DocumentProcessor; DocumentProcessor().build_vector_store()"
# or: python backend-agent/infra/document_processor.py
```

### Agent System Status
Check the agent system status:
```shell
# Via API
curl http://localhost:5111/health
curl http://localhost:5111/status

# Or check the agent logs in the main server console
```

### Manual Agent Restart
If needed, run the agent from project root (so paths resolve correctly):
```shell
cd backend-agent
python api/agent_server.py
```
Or: `PYTHONPATH=backend-agent python backend-agent/api/agent_server.py`

## 🎯 Model Support

MetaDock supports multiple AI models:

### Supported Models
- **Qwen Plus** (Default) - Fast and balanced performance
  - Requires: `DASHSCOPE_API_KEY` environment variable
  - Get key at: https://dashscope.console.aliyun.com/

- **Gemini 2.5 Pro** - Advanced reasoning capabilities
  - Requires: `GEMINI_API_KEY` environment variable
  - Get key at: https://aistudio.google.com/apikey
  - Install package: `pip install google-genai`

- **DeepSeek R1 8B** - Local model via Ollama
  - No API key required
  - Requires: Ollama installed and running locally
  - Install: https://ollama.com/

### Switching Models
Users can switch between models in the AI Agent settings panel in the web interface.