"""
Multi-LLM Client supporting Qwen and Gemini models
"""

import os
import logging
from typing import Optional, Dict, Any, Iterator
from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain_core.runnables import Runnable
from langchain_core.outputs import LLMResult, Generation
try:
    import google.genai as genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    genai = None
    types = None
    GENAI_AVAILABLE = False

try:
    import ollama
    OLLAMA_AVAILABLE = True
except ImportError:
    ollama = None
    OLLAMA_AVAILABLE = False

logger = logging.getLogger(__name__)

class GeminiStreamAdapter(Runnable):
    """Adapter to make Gemini API compatible with LangChain streaming interface"""
    
    def __init__(self, api_key: str, model: str = "gemini-2.5-pro"):
        if not GENAI_AVAILABLE:
            raise ImportError("google-genai package is not installed. Please install it with: pip install google-genai")

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
    
    def _invoke_gemini(self, prompt: str) -> str:
        """Internal method to invoke Gemini"""
        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=prompt
            )
            return response.text if hasattr(response, 'text') else str(response)
        except Exception as e:
            logger.error(f"Gemini API error: {e}")
            raise
    
    def _stream_gemini(self, messages) -> Iterator[str]:
        """Internal method to stream from Gemini"""
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
    
    # Implement Runnable interface methods for LangChain compatibility
    def invoke(self, input_data, config=None, **kwargs):
        """Invoke method for LangChain compatibility"""
        if isinstance(input_data, dict):
            # Handle prompt template input
            if 'messages' in input_data:
                return self.invoke(input_data['messages'])
            elif 'question' in input_data:
                return self.invoke(input_data['question'])
            else:
                # Try to find the main content
                for key in ['text', 'content', 'prompt']:
                    if key in input_data:
                        return self.invoke(input_data[key])
                # If no recognizable key, convert to string
                return self.invoke(str(input_data))
        elif isinstance(input_data, list):
            # Handle list of messages - call original invoke method
            prompt = self._convert_messages_to_prompt(input_data)
            return self._invoke_gemini(prompt)
        else:
            # Handle string input - call original invoke method
            return self._invoke_gemini(str(input_data))
    
    def stream(self, input_data, config=None, **kwargs):
        """Stream method for LangChain compatibility"""
        if isinstance(input_data, dict):
            # Handle prompt template input
            if 'messages' in input_data:
                for chunk in self._stream_gemini(input_data['messages']):
                    yield chunk
            elif 'question' in input_data:
                for chunk in self._stream_gemini(input_data['question']):
                    yield chunk
            else:
                # Try to find the main content
                for key in ['text', 'content', 'prompt']:
                    if key in input_data:
                        for chunk in self._stream_gemini(input_data[key]):
                            yield chunk
                        return
                # If no recognizable key, convert to string
                for chunk in self._stream_gemini(str(input_data)):
                    yield chunk
        elif isinstance(input_data, list):
            # Handle list of messages - call original stream method
            for chunk in self._stream_gemini(input_data):
                yield chunk
        else:
            # Handle string input - call original stream method
            for chunk in self._stream_gemini(str(input_data)):
                yield chunk

class OllamaStreamAdapter(Runnable):
    """Adapter to make Ollama API compatible with LangChain streaming interface"""
    
    def __init__(self, model: str = "deepseek-r1:8b", host: str = "http://localhost:11434"):
        if not OLLAMA_AVAILABLE:
            raise ImportError("ollama package is not installed. Please install it with: pip install ollama")
        
        self.model = model
        self.host = host
        self.client = ollama.Client(host=host)
        
        # Test connection with alternative method
        import time
        import requests
        
        # First try direct HTTP request to verify Ollama is accessible
        try:
            response = requests.get(f"{host}/api/tags", timeout=5)
            if response.status_code == 200:
                logger.info(f"Ollama HTTP endpoint accessible at {host}")
                models_data = response.json()
                model_names = [model['name'] for model in models_data.get('models', [])]
                
                if self.model not in model_names:
                    logger.warning(f"Model {self.model} not found in Ollama. Available models: {model_names}")
                    # Don't raise error, just warn - the model might be pulled later
                    
            else:
                raise Exception(f"HTTP {response.status_code}: {response.text}")
                
        except requests.exceptions.RequestException as e:
            logger.error(f"Direct HTTP test failed for Ollama at {host}: {e}")
            raise ConnectionError(f"Cannot connect to Ollama at {host}. Make sure Ollama is running with 'ollama serve'. Error: {str(e)}")
        
        # Now test the ollama client
        max_retries = 2
        for attempt in range(max_retries):
            try:
                # Try to list models using ollama client
                models = self.client.list()
                logger.info(f"Ollama client connected successfully at {host}")
                break  # Success, exit retry loop
                
            except Exception as e:
                if attempt < max_retries - 1:
                    logger.warning(f"Ollama client attempt {attempt + 1} failed: {e}. Retrying...")
                    time.sleep(1)  # Wait 1 second before retry
                else:
                    logger.warning(f"Ollama client failed after {max_retries} attempts: {e}")
                    logger.info("Will proceed with direct HTTP requests instead of ollama client")
                    # Don't raise error, we'll use direct HTTP requests
                    break
    
    def _convert_messages_to_prompt(self, messages) -> str:
        """Convert LangChain messages to Ollama prompt format"""
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
    
    def _generate_with_http(self, prompt: str, stream: bool = False):
        """Fallback method using direct HTTP requests"""
        import requests
        import json
        
        url = f"{self.host}/api/generate"
        data = {
            "model": self.model,
            "prompt": prompt,
            "stream": stream
        }
        
        if stream:
            response = requests.post(url, json=data, stream=True, timeout=30)
            response.raise_for_status()
            
            for line in response.iter_lines():
                if line:
                    try:
                        chunk_data = json.loads(line.decode('utf-8'))
                        if chunk_data.get('response'):
                            class MockChunk:
                                def __init__(self, content):
                                    self.content = content
                            yield MockChunk(chunk_data['response'])
                    except json.JSONDecodeError:
                        continue
        else:
            response = requests.post(url, json=data, timeout=30)
            response.raise_for_status()
            result = response.json()
            return result.get('response', '')
    
    def _ollama_stream(self, messages) -> Iterator[str]:
        """Stream response from Ollama API"""
        try:
            prompt = self._convert_messages_to_prompt(messages)
            
            # Try ollama client first, fallback to HTTP
            try:
                response = self.client.generate(
                    model=self.model,
                    prompt=prompt,
                    stream=True
                )
                
                for chunk in response:
                    if hasattr(chunk, 'response') and chunk.response:
                        # Handle response object
                        class MockChunk:
                            def __init__(self, content):
                                self.content = content
                        yield MockChunk(chunk.response)
                    elif isinstance(chunk, dict) and chunk.get('response'):
                        # Handle dictionary response
                        class MockChunk:
                            def __init__(self, content):
                                self.content = content
                        yield MockChunk(chunk['response'])
                        
            except Exception as client_error:
                logger.warning(f"Ollama client failed, trying HTTP fallback: {client_error}")
                # Fallback to direct HTTP requests
                for chunk in self._generate_with_http(prompt, stream=True):
                    yield chunk
                    
        except Exception as e:
            logger.error(f"Ollama API error: {e}")
            raise
    
    def _ollama_invoke(self, messages) -> str:
        """Non-streaming invoke for Ollama API"""
        try:
            prompt = self._convert_messages_to_prompt(messages)
            
            # Try ollama client first, fallback to HTTP
            try:
                response = self.client.generate(
                    model=self.model,
                    prompt=prompt,
                    stream=False
                )
                
                # Handle different response formats
                if hasattr(response, 'response'):
                    return response.response
                elif isinstance(response, dict):
                    return response.get('response', '')
                else:
                    return str(response)
                    
            except Exception as client_error:
                logger.warning(f"Ollama client failed, trying HTTP fallback: {client_error}")
                # Fallback to direct HTTP requests
                return self._generate_with_http(prompt, stream=False)
            
        except Exception as e:
            logger.error(f"Ollama API error: {e}")
            raise
    
    # Implement Runnable interface methods for LangChain compatibility
    def invoke(self, input_data, config=None, **kwargs):
        """Invoke method for LangChain compatibility - override the duplicate method"""
        if isinstance(input_data, dict):
            # Handle prompt template input
            if 'messages' in input_data:
                return self.invoke(input_data['messages'])
            elif 'question' in input_data:
                return self.invoke(input_data['question'])
            else:
                # Try to find the main content
                for key in ['text', 'content', 'prompt']:
                    if key in input_data:
                        return self.invoke(input_data[key])
                # If no recognizable key, convert to string
                return self.invoke(str(input_data))
        else:
            # Handle string or list input - call the actual Ollama invoke method
            return self._ollama_invoke(input_data)
    
    def stream(self, input_data, config=None, **kwargs):
        """Stream method for LangChain compatibility - override the duplicate method"""
        if isinstance(input_data, dict):
            # Handle prompt template input
            if 'messages' in input_data:
                for chunk in self._ollama_stream(input_data['messages']):
                    yield chunk
            elif 'question' in input_data:
                for chunk in self._ollama_stream(input_data['question']):
                    yield chunk
            else:
                # Try to find the main content
                for key in ['text', 'content', 'prompt']:
                    if key in input_data:
                        for chunk in self._ollama_stream(input_data[key]):
                            yield chunk
                        return
                # If no recognizable key, convert to string
                for chunk in self._ollama_stream(str(input_data)):
                    yield chunk
        else:
            # Handle string or list input - call original stream method
            for chunk in self._ollama_stream(input_data):
                yield chunk

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
        },
        "deepseek-r1:8b": {
            "provider": "ollama",
            "api_key_env": None,  # Ollama doesn't need API key
            "display_name": "DeepSeek R1 8B (Local)",
            "host": "http://localhost:11434"
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
                if not GENAI_AVAILABLE:
                    logger.warning("Gemini support not available - google-genai package not installed")
                    # Fall back to qwen-plus
                    logger.info("Falling back to qwen-plus model")
                    self.model_name = "qwen-plus"
                    fallback_config = self.SUPPORTED_MODELS["qwen-plus"]
                    
                    api_key = self._get_api_key("qwen", fallback_config["api_key_env"])
                    if not api_key:
                        raise ValueError(f"No API key found for Qwen. Set {fallback_config['api_key_env']} or provide custom API key")
                    
                    self.current_llm = ChatOpenAI(
                        api_key=api_key,
                        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                        model="qwen-plus",
                        temperature=0.1,
                        streaming=True,
                    )
                    logger.info(f"Initialized Qwen model (fallback): {self.model_name}")
                else:
                    api_key = self._get_api_key("gemini", model_config["api_key_env"])
                    if not api_key:
                        raise ValueError(f"No API key found for Gemini. Set {model_config['api_key_env']} or provide custom API key")
                    
                    self.current_llm = GeminiStreamAdapter(api_key, self.model_name)
                    logger.info(f"Initialized Gemini model: {self.model_name}")
            
            elif provider == "ollama":
                if not OLLAMA_AVAILABLE:
                    logger.warning("Ollama support not available - ollama package not installed")
                    # Fall back to qwen-plus
                    logger.info("Falling back to qwen-plus model")
                    self.model_name = "qwen-plus"
                    fallback_config = self.SUPPORTED_MODELS["qwen-plus"]
                    
                    api_key = self._get_api_key("qwen", fallback_config["api_key_env"])
                    if not api_key:
                        raise ValueError(f"No API key found for Qwen. Set {fallback_config['api_key_env']} or provide custom API key")
                    
                    self.current_llm = ChatOpenAI(
                        api_key=api_key,
                        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                        model="qwen-plus",
                        temperature=0.1,
                        streaming=True,
                    )
                    logger.info(f"Initialized Qwen model (fallback): qwen-plus")
                else:
                    # Get Ollama host from config or custom settings
                    host = model_config.get("host", "http://localhost:11434")
                    if "ollama_host" in self.custom_api_keys:
                        host = self.custom_api_keys["ollama_host"]
                    
                    self.current_llm = OllamaStreamAdapter(self.model_name, host)
                    logger.info(f"Initialized Ollama model: {self.model_name} at {host}")
                
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
        
        # For Ollama, we don't need API key, just check if it's available
        if model_config["provider"] == "ollama":
            has_api_key = OLLAMA_AVAILABLE  # Ollama availability instead of API key
        else:
            has_api_key = self._get_api_key(model_config["provider"], model_config["api_key_env"]) is not None
        
        return {
            "model_name": self.model_name,
            "display_name": model_config["display_name"],
            "provider": model_config["provider"],
            "has_api_key": has_api_key
        }
    
    @classmethod
    def get_supported_models(cls) -> Dict[str, Dict[str, str]]:
        """Get list of supported models"""
        return cls.SUPPORTED_MODELS.copy()

# Global instance
_global_client = None

def get_llm_client(model_name: Optional[str] = None, custom_api_keys: Optional[Dict[str, str]] = None):
    """Get or create global LLM client instance"""
    global _global_client
    
    # If no model_name specified, use current global client or default to qwen-plus
    if model_name is None:
        if _global_client is not None:
            return _global_client
        model_name = "qwen-plus"
    
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

# Note: Static llm instance removed to prevent model switching issues
# Use get_llm_client().get_llm() dynamically instead