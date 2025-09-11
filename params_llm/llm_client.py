"""
LLM Client Configuration
Unified LLM client for parameter extraction using Qianwen (千问)
"""

import os
from openai import OpenAI
from typing import Optional

class LLMClient:
    """Unified LLM client for parameter extraction"""
    
    def __init__(self, api_key: Optional[str] = None, model: str = "qwen-plus"):
        """
        Initialize LLM client
        
        Args:
            api_key: DashScope API key (optional, uses DASHSCOPE_API_KEY env var)
            model: Model to use (default: qwen-plus)
        """
        self.api_key = api_key or os.getenv("DASHSCOPE_API_KEY")
        if not self.api_key:
            raise ValueError(
                "DashScope API key not found. "
                "Set DASHSCOPE_API_KEY environment variable or pass api_key parameter."
            )
        
        self.model = model
        self.client = OpenAI(
            api_key=self.api_key,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
        )
    
    def chat_completion(self, messages, temperature=0.1, timeout=120):
        """
        Create chat completion
        
        Args:
            messages: List of messages
            temperature: Temperature for generation
            timeout: Timeout in seconds (default: 120)
            
        Returns:
            Chat completion response
        """
        return self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            timeout=timeout
        )

# Global LLM client instance
llm_client = None

def get_llm_client(api_key: Optional[str] = None, model: str = "qwen-plus") -> LLMClient:
    """
    Get or create LLM client instance
    
    Args:
        api_key: DashScope API key
        model: Model to use
        
    Returns:
        LLMClient instance
    """
    global llm_client
    
    if llm_client is None:
        llm_client = LLMClient(api_key=api_key, model=model)
    
    return llm_client