import os
from openai import OpenAI
from langchain_openai import ChatOpenAI

# LangChain LLM wrapper
llm = ChatOpenAI(
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
    model="qwen-plus",
    temperature=0.1,
    streaming=True,
)
