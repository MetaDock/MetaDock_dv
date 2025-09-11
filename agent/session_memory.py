"""
Session Memory Manager - Simplified Version
Focuses on short-term memory (conversation history management within a single session)
"""

import json
import logging
import os
import uuid
from datetime import datetime
from typing import Dict, List, Any, Optional
from pathlib import Path
from dataclasses import dataclass, asdict
import threading

logger = logging.getLogger(__name__)


@dataclass
class ConversationTurn:
    """Conversation Turn"""
    id: str
    role: str  # 'user' or 'assistant'
    content: str
    timestamp: datetime
    sources: List[Dict[str, Any]] = None
    steps: List[str] = None
    metadata: Dict[str, Any] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary format"""
        data = {
            'id': self.id,
            'role': self.role,
            'content': self.content,
            'timestamp': self.timestamp.isoformat()
        }
        
        if self.sources:
            data['sources'] = self.sources
        if self.steps:
            data['steps'] = self.steps
        if self.metadata:
            data['metadata'] = self.metadata
            
        return data
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ConversationTurn':
        """Create instance from dictionary"""
        return cls(
            id=data['id'],
            role=data['role'],
            content=data['content'],
            timestamp=datetime.fromisoformat(data['timestamp']),
            sources=data.get('sources'),
            steps=data.get('steps'),
            metadata=data.get('metadata')
        )


class SessionMemory:
    """Session Memory Manager"""
    
    def __init__(self, memory_store_path: str = "./memory_store"):
        """
        Initialize session memory manager
        
        Args:
            memory_store_path: Memory storage path
        """
        self.memory_store_path = Path(memory_store_path)
        self.current_session_id: Optional[str] = None
        self.current_session_title: Optional[str] = None
        self.conversation_history: List[ConversationTurn] = []
        self.lock = threading.Lock()
        
        # Ensure storage directory exists
        self.memory_store_path.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"SessionMemory initialized with store path: {self.memory_store_path}")
    
    def start_new_session(self, session_id: str = None) -> str:
        """
        Start new session
        
        Args:
            session_id: Specified session ID, auto-generated if None
            
        Returns:
            Session ID
        """
        with self.lock:
            # Save current session (if exists)
            if self.current_session_id and self.conversation_history:
                self._save_session_to_file()
            
            # Start new session
            if session_id is None:
                session_id = f"session_{int(datetime.now().timestamp())}_{str(uuid.uuid4())[:8]}"
            
            self.current_session_id = session_id
            self.current_session_title = None
            self.conversation_history = []
            
            logger.info(f"Started new session: {session_id}")
            return session_id
    
    def load_session(self, session_id: str) -> bool:
        """
        Load existing session
        
        Args:
            session_id: Session ID
            
        Returns:
            Whether successfully loaded
        """
        with self.lock:
            session_file = self.memory_store_path / f"{session_id}.json"
            
            if not session_file.exists():
                logger.warning(f"Session file not found: {session_file}")
                return False
            
            try:
                # Save current session
                if self.current_session_id and self.conversation_history:
                    self._save_session_to_file()
                
                # Load new session
                with open(session_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                self.current_session_id = data['session_id']
                self.current_session_title = data.get('title', 'New Conversation')
                self.conversation_history = [
                    ConversationTurn.from_dict(turn_data) 
                    for turn_data in data['conversation_history']
                ]
                
                logger.info(f"Loaded session: {session_id} with {len(self.conversation_history)} turns")
                return True
                
            except Exception as e:
                logger.error(f"Error loading session {session_id}: {e}")
                return False
    
    def add_conversation_turn(self, role: str, content: str, 
                            sources: List[Dict[str, Any]] = None, 
                            steps: List[str] = None,
                            metadata: Dict[str, Any] = None) -> str:
        """
        Add conversation turn
        
        Args:
            role: Role ('user' or 'assistant')
            content: Conversation content
            sources: Source information
            steps: Processing steps
            metadata: Metadata
            
        Returns:
            Conversation turn ID
        """
        with self.lock:
            if not self.current_session_id:
                self.start_new_session()
            
            turn_id = str(uuid.uuid4())
            turn = ConversationTurn(
                id=turn_id,
                role=role,
                content=content,
                timestamp=datetime.now(),
                sources=sources,
                steps=steps,
                metadata=metadata
            )
            
            self.conversation_history.append(turn)
            
            # Limit history length to avoid excessive memory usage
            max_history_length = 100
            if len(self.conversation_history) > max_history_length:
                self.conversation_history = self.conversation_history[-max_history_length:]
                logger.info(f"Trimmed conversation history to {max_history_length} turns")
            
            logger.debug(f"Added conversation turn: {role} - {content[:50]}...")
            return turn_id
    
    def get_conversation_history(self, limit: int = None) -> List[Dict[str, Any]]:
        """
        Get conversation history
        
        Args:
            limit: Limit the number of conversation turns returned
            
        Returns:
            Conversation history list
        """
        with self.lock:
            history = [turn.to_dict() for turn in self.conversation_history]
            
            if limit and limit > 0:
                history = history[-limit:]
            
            return history
    
    def get_context_for_llm(self, max_tokens: int = 4000) -> List[Dict[str, str]]:
        """
        Get conversation context suitable for LLM use
        
        Args:
            max_tokens: Maximum token count limit
            
        Returns:
            Formatted conversation context
        """
        with self.lock:
            context = []
            total_chars = 0
            
            # Start from the latest conversation and truncate backwards
            for turn in reversed(self.conversation_history):
                # Simple token estimation: 1 character ≈ 0.5 tokens
                turn_chars = len(turn.content)
                if total_chars + turn_chars > max_tokens * 2:
                    break
                
                context.insert(0, {
                    'role': turn.role,
                    'content': turn.content
                })
                total_chars += turn_chars
            
            return context
    
    def clear_current_session(self):
        """Clear current session history"""
        with self.lock:
            if self.current_session_id:
                logger.info(f"Clearing session: {self.current_session_id}")
                self.conversation_history = []
            else:
                logger.warning("No active session to clear")
    
    def update_session_title(self, title: str):
        """
        Update current session title
        
        Args:
            title: New session title
        """
        with self.lock:
            if self.current_session_id:
                self.current_session_title = title
                self._save_session_to_file()
                logger.info(f"Updated session title: {title}")
            else:
                logger.warning("No active session to update title")
    
    def save_current_session(self):
        """Save current session to file"""
        with self.lock:
            if self.current_session_id and self.conversation_history:
                self._save_session_to_file()
                logger.info(f"Saved current session: {self.current_session_id}")
            else:
                logger.warning("No active session or empty history to save")
    
    def _save_session_to_file(self):
        """Internal method: save session to file"""
        if not self.current_session_id:
            return
        
        session_file = self.memory_store_path / f"{self.current_session_id}.json"
        
        try:
            session_data = {
                'session_id': self.current_session_id,
                'title': self.current_session_title or 'New Conversation',
                'created_at': self.conversation_history[0].timestamp.isoformat() if self.conversation_history else datetime.now().isoformat(),
                'last_updated': datetime.now().isoformat(),
                'conversation_history': [turn.to_dict() for turn in self.conversation_history]
            }
            
            with open(session_file, 'w', encoding='utf-8') as f:
                json.dump(session_data, f, ensure_ascii=False, indent=2)
            
            logger.debug(f"Session saved to: {session_file}")
            
        except Exception as e:
            logger.error(f"Error saving session to file: {e}")
    
    def get_session_list(self) -> List[Dict[str, Any]]:
        """
        Get all session list
        
        Returns:
            Session information list
        """
        sessions = []
        
        try:
            for session_file in self.memory_store_path.glob("session_*.json"):
                try:
                    with open(session_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    
                    sessions.append({
                        'session_id': data['session_id'],
                        'title': data.get('title', 'New Conversation'),
                        'created_at': data.get('created_at'),
                        'last_updated': data.get('last_updated'),
                        'message_count': len(data.get('conversation_history', []))
                    })
                    
                except Exception as e:
                    logger.error(f"Error reading session file {session_file}: {e}")
                    continue
            
            # Sort by last update time
            sessions.sort(key=lambda x: x.get('last_updated', ''), reverse=True)
            
        except Exception as e:
            logger.error(f"Error getting session list: {e}")
        
        return sessions
    
    def delete_session(self, session_id: str) -> bool:
        """
        Delete specified session
        
        Args:
            session_id: Session ID
            
        Returns:
            Whether deletion was successful
        """
        session_file = self.memory_store_path / f"{session_id}.json"
        
        try:
            if session_file.exists():
                session_file.unlink()
                logger.info(f"Deleted session: {session_id}")
                
                # If deleting current session, clear history in memory
                if self.current_session_id == session_id:
                    self.current_session_id = None
                    self.conversation_history = []
                
                return True
            else:
                logger.warning(f"Session file not found: {session_file}")
                return False
                
        except Exception as e:
            logger.error(f"Error deleting session {session_id}: {e}")
            return False
    
    def get_session_stats(self) -> Dict[str, Any]:
        """
        Get session statistics
        
        Returns:
            Statistics information
        """
        with self.lock:
            stats = {
                'current_session_id': self.current_session_id,
                'current_session_turns': len(self.conversation_history),
                'total_sessions': len(list(self.memory_store_path.glob("session_*.json"))),
                'memory_store_path': str(self.memory_store_path)
            }
            
            if self.conversation_history:
                stats['first_message_time'] = self.conversation_history[0].timestamp.isoformat()
                stats['last_message_time'] = self.conversation_history[-1].timestamp.isoformat()
            
            return stats
    
    def cleanup_old_sessions(self, days_to_keep: int = 30) -> int:
        """
        Clean up old session files
        
        Args:
            days_to_keep: Number of days to keep
            
        Returns:
            Number of deleted sessions
        """
        from datetime import timedelta
        
        cutoff_date = datetime.now() - timedelta(days=days_to_keep)
        deleted_count = 0
        
        try:
            for session_file in self.memory_store_path.glob("session_*.json"):
                try:
                    # Check file modification time
                    file_mtime = datetime.fromtimestamp(session_file.stat().st_mtime)
                    
                    if file_mtime < cutoff_date:
                        session_file.unlink()
                        deleted_count += 1
                        logger.debug(f"Deleted old session file: {session_file.name}")
                        
                except Exception as e:
                    logger.error(f"Error processing session file {session_file}: {e}")
                    continue
            
            logger.info(f"Cleaned up {deleted_count} old session files (older than {days_to_keep} days)")
            
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")
        
        return deleted_count 