import json
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime

from rag_system import RAGSystem
from agent_client import llm
from langchain.prompts import PromptTemplate

# configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class BioinfoAgent:
    """bioinformatics tool question-answering agent"""
    
    def __init__(self, docs_path: str = "../help_pages_for_test", vector_store_path: str = "agent/vector_store"):
        """
        initialize the agent
        
        Args:
            docs_path: path to the documents
            vector_store_path: path to the vector store
        """
        self.docs_path = docs_path
        self.rag_system = RAGSystem(docs_path=docs_path, vector_store_path=vector_store_path)
        self.conversation_history: List[Dict[str, Any]] = []
        self.is_initialized = False
        self.available_tools: List[str] = []
        
    def initialize(self) -> bool:
        """
        Initializes the agent, its components, and retrieves the available tool list.
        """
        if self.is_initialized:
            return True
        try:
            self.rag_system.initialize()
            self.available_tools = self.rag_system.get_available_tools()
            self.is_initialized = True
            logging.info("BioinfoAgent initialized successfully!")
            return True
        except Exception as e:
            logging.error(f"Error during agent initialization: {e}", exc_info=True)
            self.is_initialized = False
            return False
    
    def ask_stream(self, question: str):
        """
        Processes a question with streaming. It first tries the RAG system.
        If no context is found, it falls back to a general LLM stream.
        Yields JSON-formatted events.
        """
        self.add_to_history("user", question)

        target_tool = None
        if self.available_tools:
            for tool in self.available_tools:
                if tool.lower() in question.lower():
                    target_tool = tool
                    break
        
        try:
            rag_stream = self.rag_system.stream_answer_with_context(question, target_tool=target_tool)
            
            full_answer = ""
            sources = []
            rag_had_context = False

            for event in rag_stream:
                rag_had_context = True # If we get any event, it means context was found
                
                if event['type'] == 'no_context':
                    rag_had_context = False
                    break # Exit loop to trigger fallback

                yield json.dumps(event) # Pass on sources, chunk, etc.

                if event['type'] == 'final_data':
                    full_answer = event.get('answer', '')
                    sources = event.get('sources', [])
            
            # If RAG had context, the answer is complete. Add to history.
            if rag_had_context:
                if full_answer:
                    self.add_to_history("assistant", full_answer, sources=sources)
                return

            # Fallback to general LLM if RAG had no context
            logging.info("RAG system found no context, falling back to streaming LLM.")
            prompt = self._create_prompt(question)
            
            yield json.dumps({"type": "stream_start"})
            
            llm_answer = ""
            for chunk in llm.stream(prompt):
                content = chunk.content if hasattr(chunk, 'content') else str(chunk)
                if content:
                    llm_answer += content
                    yield json.dumps({"type": "chunk", "content": content})

            final_data = {"answer": llm_answer, "sources": []}
            yield json.dumps({"type": "final_data", "data": final_data})
            self.add_to_history("assistant", llm_answer)

        except Exception as e:
            logging.error(f"Error during agent's ask_stream method: {e}", exc_info=True)
            error_message = {"type": "error", "error": f"An unexpected error occurred: {e}"}
            yield json.dumps(error_message)

    def add_to_history(self, role: str, content: str, sources: list = None):
        """Adds a message to the conversation history."""
        entry = {
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat()
        }
        if sources:
            entry["sources"] = sources
        self.conversation_history.append(entry)

    def _create_prompt(self, question: str) -> str:
        """Creates a prompt for the general LLM, including conversation history."""
        # Simplified history formatting
        # ... existing code ...
    
    def search_tools(self, query: str, k: int = 5) -> List[Dict]:
        """
        search for related tools
        
        Args:
            query: search query
            k: number of results to return
            
        Returns:
            list of related tools
        """
        if not self.is_initialized:
            return []
        
        try:
            return self.rag_system.search_similar(query, k=k)
        except Exception as e:
            logger.error(f"Error searching for tools: {e}")
            return []
    
    def get_conversation_history(self) -> List[Dict]:
        """get conversation history"""
        return self.conversation_history
    
    def clear_history(self):
        """clear conversation history"""
        self.conversation_history = []
        logger.info("Conversation history cleared")
    
    def get_available_tools(self) -> List[str]:
        """get available tool list"""
        if not self.is_initialized:
            return []
        
        try:
            # get all document metadata from the vector store
            all_docs = self.rag_system.vector_store.docstore._dict
            tools = set()
            
            for doc_id, doc in all_docs.items():
                if hasattr(doc, 'metadata') and 'tool_name' in doc.metadata:
                    tools.add(doc.metadata['tool_name'])
            
            return sorted(list(tools))
        except Exception as e:
            logger.error(f"Error getting tool list: {e}")
            return []
    
    def get_tool_info(self, tool_name: str) -> Optional[Dict]:
        """
        get detailed information for a specific tool
        
        Args:
            tool_name: tool name
            
        Returns:
            tool information dictionary
        """
        if not self.is_initialized:
            return None
        
        try:
            # search for the related information of the tool
            docs = self.rag_system.vector_store.similarity_search(
                f"{tool_name} tool usage parameters", 
                k=3
            )
            
            if docs:
                return {
                    "tool_name": tool_name,
                    "description": docs[0].page_content[:500] + "...",
                    "sources": [doc.metadata for doc in docs]
                }
            return None
            
        except Exception as e:
            logger.error(f"Error getting tool information: {e}")
            return None
    
    def export_conversation(self, filepath: str):
        """export conversation history to a file"""
        try:
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(self.conversation_history, f, ensure_ascii=False, indent=2)
            logger.info(f"Conversation history exported to: {filepath}")
        except Exception as e:
            logger.error(f"Error exporting conversation history: {e}")


def create_agent(docs_path: str = "../help_pages_for_test") -> BioinfoAgent:
    """
    create and initialize the agent
    
    Args:
        docs_path: path to the documents
        
    Returns:
        initialized agent instance
    """
    agent = BioinfoAgent(docs_path=docs_path)
    if agent.initialize():
        return agent
    else:
        raise RuntimeError("Agent initialization failed")
