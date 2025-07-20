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

5.  **Initialize the AI Agent System (First Time Only)**
    Initialize the Adaptive RAG system and build the vector database:
    ```shell
    cd agent
    python init_system.py
    cd ..
    ```
    
    This step:
    - ✅ Checks all dependencies
    - ✅ Validates LLM client configuration
    - ✅ Processes bioinformatics tool documentation
    - ✅ Builds vector database for fast retrieval
    - ✅ Tests the complete system

6.  **Start the application**
    This will launch the Node.js server, which automatically starts the Python agent server:
    ```shell
    node server.js
    ```

7.  **Access the application**
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

### Environment Configuration

You need to manually add environment variables to your `.env` file:

```env
# OpenAI API Configuration (if using OpenAI)
OPENAI_API_KEY=your_openai_api_key_here

# Or other LLM configuration as needed
# Check agent_client.py for specific requirements
```