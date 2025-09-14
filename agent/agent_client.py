"""
Multi-LLM Client supporting Qwen and Gemini models
"""

import os
import logging
from typing import Optional, Dict, Any, Iterator
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from google import genai
from google.genai import types

logger = logging.getLogger(__name__)

class GeminiStreamAdapter:
    """Adapter to make Gemini API compatible with LangChain streaming interface"""
    
    def __init__(self, api_key: str, model: str = "gemini-2.5-pro"):
        self.client = genai.Client(api_key=api_key)
        self.model = model
    
    def _convert_messages_to_prompt(self, messages) -> str:
        """Convert LangChain messages to Gemini prompt format"""
        if isinstance(messages, str):
            return messages
        
        prompt_parts = []
        for msg in messages:
            if hasattr(msg, 'content'):
                content = msg.content
            else:
                content = str(msg)
            
            if isinstance(msg, HumanMessage):
                prompt_parts.append(f"Human: {content}")
            elif isinstance(msg, AIMessage):
                prompt_parts.append(f"Assistant: {content}")
            else:
                prompt_parts.append(content)
        
        return "\n\n".join(prompt_parts)
    
    def stream(self, messages) -> Iterator[str]:
        """Stream response from Gemini API"""
        try:
            prompt = self._convert_messages_to_prompt(messages)
            
            # Call Gemini API with streaming
            response = self.client.models.generate_content(
                model=self.model,
                contents=prompt
            )
            
            # Gemini returns full response, we need to simulate streaming
            # For now, yield the full response as chunks
            full_text = response.text if hasattr(response, 'text') else str(response)
            
            # Split into chunks for streaming effect
            chunk_size = 50
            for i in range(0, len(full_text), chunk_size):
                chunk = full_text[i:i + chunk_size]
                # Create a mock chunk object similar to LangChain
                class MockChunk:
                    def __init__(self, content):
                        self.content = content
                
                yield MockChunk(chunk)
                
        except Exception as e:
            logger.error(f"Gemini API error: {e}")
            raise
    
    def invoke(self, messages) -> str:
        """Non-streaming invoke for compatibility"""
        try:
            prompt = self._convert_messages_to_prompt(messages)
            
            response = self.client.models.generate_content(
                model=self.model,
                contents=prompt
            )
            
            return response.text if hasattr(response, 'text') else str(response)
            
        except Exception as e:
            logger.error(f"Gemini API error: {e}")
            raise

class MultiLLMClient:
    """Multi-model LLM client supporting Qwen and Gemini"""
    
    SUPPORTED_MODELS = {
        "qwen-plus": {
            "provider": "qwen",
            "api_key_env": "DASHSCOPE_API_KEY",
            "display_name": "Qwen Plus"
        },
        "gemini-2.5-pro": {
            "provider": "gemini",
            "api_key_env": "GEMINI_API_KEY", 
            "display_name": "Gemini 2.5 Pro"
        }
    }
    
    def __init__(self, model_name: str = "qwen-plus", custom_api_keys: Optional[Dict[str, str]] = None):
        self.model_name = model_name
        self.custom_api_keys = custom_api_keys or {}
        self.current_llm = None
        
        if model_name not in self.SUPPORTED_MODELS:
            raise ValueError(f"Unsupported model: {model_name}")
        
        self._initialize_llm()
    
    def _get_api_key(self, provider: str, env_var: str) -> Optional[str]:
        """Get API key from custom keys or environment"""
        if provider in self.custom_api_keys:
            return self.custom_api_keys[provider]
        return os.getenv(env_var)
    
    def _initialize_llm(self):
        """Initialize the appropriate LLM client"""
        model_config = self.SUPPORTED_MODELS[self.model_name]
        provider = model_config["provider"]
        
        try:
            if provider == "qwen":
                api_key = self._get_api_key("qwen", model_config["api_key_env"])
                if not api_key:
                    raise ValueError(f"No API key found for Qwen. Set {model_config['api_key_env']} or provide custom API key")
                
                self.current_llm = ChatOpenAI(
                    api_key=api_key,
                    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                    model=self.model_name,
                    temperature=0.1,
                    streaming=True,
                )
                logger.info(f"Initialized Qwen model: {self.model_name}")
                
            elif provider == "gemini":
                api_key = self._get_api_key("gemini", model_config["api_key_env"])
                if not api_key:
                    raise ValueError(f"No API key found for Gemini. Set {model_config['api_key_env']} or provide custom API key")
                
                self.current_llm = GeminiStreamAdapter(api_key, self.model_name)
                logger.info(f"Initialized Gemini model: {self.model_name}")
                
        except Exception as e:
            logger.error(f"Failed to initialize {self.model_name}: {e}")
            raise
    
    def switch_model(self, model_name: str, custom_api_keys: Optional[Dict[str, str]] = None):
        """Switch to a different model"""
        if model_name not in self.SUPPORTED_MODELS:
            raise ValueError(f"Unsupported model: {model_name}")
        
        self.model_name = model_name
        if custom_api_keys:
            self.custom_api_keys.update(custom_api_keys)
        
        self._initialize_llm()
        logger.info(f"Switched to model: {model_name}")
    
    def get_llm(self):
        """Get the current LLM instance"""
        if self.current_llm is None:
            raise RuntimeError("LLM not initialized")
        return self.current_llm
    
    def get_model_info(self) -> Dict[str, Any]:
        """Get current model information"""
        model_config = self.SUPPORTED_MODELS[self.model_name]
        return {
            "model_name": self.model_name,
            "display_name": model_config["display_name"],
            "provider": model_config["provider"],
            "has_api_key": self._get_api_key(model_config["provider"], model_config["api_key_env"]) is not None
        }
    
    @classmethod
    def get_supported_models(cls) -> Dict[str, Dict[str, str]]:
        """Get list of supported models"""
        return cls.SUPPORTED_MODELS.copy()

# Global instance
_global_client = None

def get_llm_client(model_name: str = "qwen-plus", custom_api_keys: Optional[Dict[str, str]] = None):
    """Get or create global LLM client instance"""
    global _global_client
    
    if _global_client is None or _global_client.model_name != model_name:
        _global_client = MultiLLMClient(model_name, custom_api_keys)
    elif custom_api_keys:
        _global_client.custom_api_keys.update(custom_api_keys)
        _global_client._initialize_llm()
    
    return _global_client

def switch_global_model(model_name: str, custom_api_keys: Optional[Dict[str, str]] = None):
    """Switch the global model"""
    global _global_client
    if _global_client is None:
        _global_client = MultiLLMClient(model_name, custom_api_keys)
    else:
        _global_client.switch_model(model_name, custom_api_keys)

# Default LLM for backward compatibility
llm = get_llm_client().get_llm()