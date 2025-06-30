from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from bioinfo_agent import BioinfoAgent
import logging
import sys
import json

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

agent = None

def initialize_agent():
    """Initializes the BioinfoAgent."""
    global agent
    if agent is None:
        logging.info("Initializing BioinfoAgent...")
        try:
            agent = BioinfoAgent()
            if agent.initialize():
                logging.info("✅ BioinfoAgent initialized successfully!")
            else:
                logging.error("❌ BioinfoAgent initialization failed!")
                # Exit if initialization fails, as the agent is critical
                sys.exit(1)
        except Exception as e:
            logging.error(f"❌ Error during BioinfoAgent initialization: {e}", exc_info=True)
            sys.exit(1)

@app.route('/ask', methods=['POST'])
def ask():
    """Handles streaming questions to the agent."""
    if not request.json or 'question' not in request.json:
        return jsonify({"error": "Invalid request. 'question' is required."}), 400

    if agent is None or not agent.is_initialized:
        return jsonify({"error": "Agent is not initialized."}), 503

    question = request.json['question']
    logging.info(f"Received streaming question: {question}")

    def generate():
        try:
            for chunk in agent.ask_stream(question):
                # Format as Server-Sent Event (SSE)
                yield f"data: {chunk}\\n\\n"
        except Exception as e:
            logging.error(f"Error during stream generation: {e}", exc_info=True)
            error_message = json.dumps({"type": "error", "error": "An internal error occurred during streaming."})
            yield f"data: {error_message}\\n\\n"

    return Response(generate(), mimetype='text/event-stream')

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    if agent and agent.is_initialized:
        return jsonify({"status": "ok", "message": "Agent is running."})
    else:
        return jsonify({"status": "error", "message": "Agent is not initialized."}), 503

if __name__ == '__main__':
    initialize_agent()
    # Use a different port to avoid conflict with the Node.js server
    port = 5111
    logging.info(f"Starting agent server on http://127.0.0.1:{port}")
    app.run(host='127.0.0.1', port=port, debug=False) 