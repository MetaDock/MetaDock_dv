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
    Modify a `.env` file in the project root directory (`MetaDock_dv/.env`) and use your API keys:
    
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
    - At least one API key (Qwen or Gemini) is required for the AI agent to work
    - Users can also input their API keys through the web interface after starting the application
    - Get Qwen API key at: https://dashscope.console.aliyun.com/
    - Get Gemini API key at: https://aistudio.google.com/apikey
    - For Gemini, also install: `pip install google-genai`

6.  **Initialize the AI Agent Vector Database (First Time Only)**
    Build the vector database for document retrieval:
    ```shell
    cd agent
    python document_processor.py
    cd ..
    ```
    
    This step:
    - ✅ Processes 12 bioinformatics tool documents from `help_pages_for_test/`
    - ✅ Builds FAISS vector database for fast semantic search
    - ✅ Generates metadata for the knowledge base
    - ⏱️ Takes approximately 1-2 minutes on first run
    - 🔄 Automatically detects and updates only changed documents on subsequent runs

7.  **Start the application**
    This will launch the Node.js server, which automatically starts the Python agent server:
    ```shell
    node server.js
    ```

8.  **Access the application**
    Open your browser and navigate to [http://localhost:3010](http://localhost:3010).

## 🔧 Agent System Maintenance

### Updating Documents
When you add or modify files in `help_pages_for_test/`, update the vector database:
```shell
cd agent
python document_processor.py  # Automatic detection of changes
python document_processor.py --force  # Force rebuild
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
If needed, restart just the agent component:
```shell
cd agent
python agent_server.py
```

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