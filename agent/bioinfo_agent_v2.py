"""
Upgraded bioinformatics Agent - using Adaptive RAG system
Supports fast startup and offline document processing
"""

import json
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime
from pathlib import Path

from adaptive_rag import AdaptiveRAG
from document_processor import DocumentProcessor
from session_memory import SessionMemory

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class BioinfoAgentV2:
    """Upgraded bioinformatics tool Q&A Agent"""
    
    def __init__(self, 
                 docs_path: List[str] = None, 
                 vector_store_path: str = "./vector_store",
                 memory_store_path: str = "./memory_store"):
        """
        Initialize Agent
        
        Args:
            docs_path: List of document paths (optional, uses default from DocumentProcessor)
            vector_store_path: Vector store path
            memory_store_path: Memory store path
        """
        self.docs_path = docs_path
        self.vector_store_path = vector_store_path
        self.memory_store_path = memory_store_path
        self.is_initialized = False
        self.available_tools: List[str] = []
        
        # Initialize document processor and RAG system
        if docs_path:
            self.document_processor = DocumentProcessor(docs_path, vector_store_path)
        else:
            self.document_processor = DocumentProcessor(vector_store_path=vector_store_path)
        self.adaptive_rag = AdaptiveRAG(vector_store_path)
        
        # Initialize session memory system
        self.session_memory = SessionMemory(memory_store_path)
        self.current_session_id: Optional[str] = None
        
    def ensure_vector_store(self) -> bool:
        """
        Ensure vector store exists and is up to date
        This method will automatically build or update vector store when needed
        """
        try:
            # Check if vector store needs updating
            if self.document_processor.need_update():
                logger.info("Vector store needs update, building...")
                success = self.document_processor.build_vector_store()
                if not success:
                    logger.error("Failed to build vector store")
                    return False
                logger.info("Vector store updated successfully")
            else:
                logger.info("Vector store is up to date")
            
            return True
            
        except Exception as e:
            logger.error("Error ensuring vector store: %s", str(e))
            return False
    
    def initialize(self) -> bool:
        """
        Fast initialize Agent
        Only load pre-built vector store, don't rebuild
        """
        if self.is_initialized:
            return True
        
        try:
            logger.info("Initializing BioinfoAgent V2...")
            
            # Quick check if vector store exists
            vector_store_dir = Path(self.vector_store_path)
            faiss_file = vector_store_dir / "index.faiss"
            pkl_file = vector_store_dir / "index.pkl"
            metadata_file = vector_store_dir / "metadata.json"
            
            if not (faiss_file.exists() and pkl_file.exists()):
                logger.warning("Vector store not found, please run document processing first")
                # Try to build vector store
                if not self.ensure_vector_store():
                    return False
            
            # Initialize RAG system
            if not self.adaptive_rag.initialize():
                logger.error("Failed to initialize Adaptive RAG system")
                return False
            
            # Load available tools list
            if metadata_file.exists():
                try:
                    with open(metadata_file, 'r', encoding='utf-8') as f:
                        metadata = json.load(f)
                        self.available_tools = metadata.get('available_tools', [])
                        logger.info("Loaded %d available tools", len(self.available_tools))
                except Exception as e:
                    logger.warning("Could not load metadata: %s", str(e))
            
            self.is_initialized = True
            logger.info("BioinfoAgent V2 initialized successfully!")
            return True
            
        except Exception as e:
            logger.error("Error during agent initialization: %s", str(e), exc_info=True)
            self.is_initialized = False
            return False
    
    def add_to_history(self, role: str, content: str, sources: List[Dict] = None, steps: List[str] = None):
        """Add to conversation history"""
        # Ensure we have an active session
        if not self.current_session_id:
            self.current_session_id = self.session_memory.start_new_session()
        
        # Add conversation turn to session memory
        self.session_memory.add_conversation_turn(
            role=role,
            content=content,
            sources=sources,
            steps=steps
        )
    
    def ask_stream(self, question: str):
        """
        Stream process question, using Adaptive RAG system
        """
        if not self.is_initialized:
            yield json.dumps({"type": "error", "error": "Agent not initialized"})
            return
        
        self.add_to_history("user", question)
        
        try:
            # Get conversation history for context
            conversation_context = self.session_memory.get_conversation_history()
            
            # Use Adaptive RAG system for streaming response
            full_answer = ""
            sources = []
            steps = []
            
            for event in self.adaptive_rag.stream_answer(question, conversation_context):
                # Forward different types of events
                if event['type'] == 'step':
                    yield json.dumps(event)
                    steps.extend(event.get('steps', []))
                    
                elif event['type'] == 'sources':
                    sources = event['sources']
                    yield json.dumps(event)
                    
                elif event['type'] == 'chunk':
                    full_answer += event['content']
                    yield json.dumps(event)
                    
                elif event['type'] == 'final':
                    full_answer = event.get('answer', full_answer)
                    sources = event.get('sources', sources)
                    steps = event.get('steps', steps)
                    yield json.dumps(event)
                    
                elif event['type'] == 'error':
                    yield json.dumps(event)
                    return
            
            # Add to history
            if full_answer:
                self.add_to_history("assistant", full_answer, sources=sources, steps=steps)
                
                # Generate title for new sessions after first Q&A
                self._generate_title_if_needed(question, full_answer)
                
        except Exception as e:
            logger.error("Error during stream processing: %s", str(e), exc_info=True)
            error_event = {
                "type": "error", 
                "error": f"Error occurred during processing: {str(e)}"
            }
            yield json.dumps(error_event)
    
    def ask_question(self, question: str) -> Dict[str, Any]:
        """
        Non-streaming Q&A (compatibility method)
        """
        if not self.is_initialized:
            return {
                "answer": "Agent not initialized",
                "sources": [],
                "question": question
            }
        
        try:
            result = self.adaptive_rag.ask_question(question)
            
            # Add to history
            self.add_to_history("user", question)
            if result.get("answer"):
                self.add_to_history(
                    "assistant", 
                    result["answer"],
                    sources=result.get("sources", []),
                    steps=result.get("steps", [])
                )
            
            return result
            
        except Exception as e:
            logger.error("Error processing question: %s", str(e), exc_info=True)
            return {
                "answer": f"Error occurred while processing question: {str(e)}",
                "sources": [],
                "question": question
            }
    
    def get_available_tools(self) -> List[str]:
        """Get available tools list"""
        return self.available_tools
    
    def get_conversation_history(self) -> List[Dict[str, Any]]:
        """Get conversation history"""
        return self.session_memory.get_conversation_history()
    
    def clear_history(self):
        """Clear conversation history"""
        self.session_memory.clear_current_session()
        self.current_session_id = None
    
    def update_documents(self, force: bool = False) -> bool:
        """
        Update document vector store
        
        Args:
            force: Whether to force update even if no changes detected
            
        Returns:
            bool: Whether update was successful
        """
        try:
            logger.info("Updating document vector store...")
            success = self.document_processor.build_vector_store(force=force)
            
            if success:
                # Re-initialize RAG system to load new vector store
                self.adaptive_rag.initialize()
                
                # Reload tools list
                metadata_file = Path(self.vector_store_path) / "metadata.json"
                if metadata_file.exists():
                    with open(metadata_file, 'r', encoding='utf-8') as f:
                        metadata = json.load(f)
                        self.available_tools = metadata.get('available_tools', [])
                
                logger.info("Document update completed successfully")
            
            return success
            
        except Exception as e:
            logger.error("Error updating documents: %s", str(e))
            return False
    
    def get_system_status(self) -> Dict[str, Any]:
        """Get system status information"""
        status = {
            "initialized": self.is_initialized,
            "available_tools": len(self.available_tools),
            "current_session_id": self.current_session_id,
        }
        
        # Add session memory stats
        memory_stats = self.session_memory.get_session_stats()
        status.update(memory_stats)
        
        # Check vector store status
        try:
            metadata_file = Path(self.vector_store_path) / "metadata.json"
            if metadata_file.exists():
                with open(metadata_file, 'r', encoding='utf-8') as f:
                    metadata = json.load(f)
                    status.update({
                        "last_update": metadata.get("last_update"),
                        "total_documents": metadata.get("total_documents", 0),
                        "total_chunks": metadata.get("total_chunks", 0),
                        "embedding_model": metadata.get("embedding_model", "unknown"),
                    })
        except:
            pass
        
        return status
    
    # === Session Management Methods ===
    
    def start_new_session(self, session_id: str = None) -> str:
        """Start a new conversation session"""
        if self.current_session_id:
            # Save current session before starting new one
            self.session_memory.save_current_session()
        
        self.current_session_id = self.session_memory.start_new_session(session_id)
        logger.info(f"Started new session: {self.current_session_id}")
        return self.current_session_id
    
    def load_session(self, session_id: str) -> bool:
        """Load an existing conversation session"""
        success = self.session_memory.load_session(session_id)
        if success:
            self.current_session_id = session_id
            logger.info(f"Loaded session: {session_id}")
        return success
    
    def save_current_session(self):
        """Save the current session to file"""
        self.session_memory.save_current_session()
    
    def get_session_list(self) -> List[Dict[str, Any]]:
        """Get list of all available sessions"""
        return self.session_memory.get_session_list()
    
    def delete_session(self, session_id: str) -> bool:
        """Delete a specific session"""
        success = self.session_memory.delete_session(session_id)
        if success and self.current_session_id == session_id:
            self.current_session_id = None
        return success
    
    def cleanup_old_sessions(self, days_to_keep: int = 30) -> int:
        """Clean up old session files"""
        return self.session_memory.cleanup_old_sessions(days_to_keep)
    
    def get_context_for_llm(self, max_tokens: int = 4000) -> List[Dict[str, str]]:
        """Get conversation context formatted for LLM"""
        return self.session_memory.get_context_for_llm(max_tokens)
    
    def _generate_title_if_needed(self, question: str, answer: str):
        """Generate title after first conversation"""
        try:
            # Check if this is the first user-agent conversation pair
            history = self.session_memory.get_conversation_history()
            current_title = self.session_memory.current_session_title
            
            # Filter only user and assistant messages (exclude any system messages)
            user_agent_pairs = [turn for turn in history if turn['role'] in ['user', 'assistant']]
            
            logger.info(f"Title generation check: user_agent_pairs={len(user_agent_pairs)}, current_title='{current_title}'")
            
            # Generate title only for the first user-assistant pair
            if len(user_agent_pairs) == 2 and (not current_title or current_title == 'New Conversation'):
                # Verify this is indeed a user question followed by assistant answer
                if (user_agent_pairs[0]['role'] == 'user' and 
                    user_agent_pairs[1]['role'] == 'assistant'):
                    
                    logger.info("Generating session title from first Q&A pair...")
                    
                    # Use the actual user question and assistant answer content
                    user_question = user_agent_pairs[0]['content']
                    assistant_answer = user_agent_pairs[1]['content']
                    
                    # Generate title based on the actual conversation content
                    title = self.adaptive_rag.generate_session_title(user_question, assistant_answer)
                    logger.info(f"Generated title: '{title}'")
                    
                    # Update title
                    self.session_memory.update_session_title(title)
                    logger.info(f"Title updated successfully")
                else:
                    logger.warning("First two messages are not user-assistant pair, skipping title generation")
            else:
                logger.info(f"Title generation skipped: user_agent_pairs={len(user_agent_pairs)}, title='{current_title}'")
        except Exception as e:
            logger.error(f"Error generating session title: {e}", exc_info=True)


# Backward compatibility - create an alias
BioinfoAgent = BioinfoAgentV2 