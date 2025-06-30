# MetaDock

## AI Agent

MetaDock includes an intelligent AI agent designed to assist with bioinformatics tool-related questions.

-   **Conversational Interface**: A draggable and resizable chat widget provides a user-friendly way to interact with the agent.
-   **Context-Aware Answers**: The agent uses a Retrieval-Augmented Generation (RAG) system, leveraging local documentation to provide accurate, context-aware answers about specific tools. If no specific context is found, it falls back to a general model.
-   **Streaming Responses**: Get real-time, token-by-token responses for a fast and interactive experience.
-   **Markdown Support**: Responses are rendered in Markdown for clear and structured formatting of text, code blocks, and lists.
-   **Persistent Chat History**: The conversation, as well as the widget's position and size, are saved in the browser's local storage, so context is never lost when navigating the application.

The agent is powered by a Python backend using Flask and LangChain, which is automatically started by the main server.

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

5.  **Start the application**
    This will launch the Node.js server, which in turn starts the Python agent server.
    ```shell
    node server.js
    ```

6.  **Access the application**
    Open your browser and navigate to [http://localhost:3010](http://localhost:3010).