from pydantic import BaseModel


class AiChatMessage(BaseModel):
    role: str
    content: str


class AiChatRequest(BaseModel):
    messages: list[AiChatMessage]


class AiChatResponse(BaseModel):
    reply: str
    actions: list[str]
