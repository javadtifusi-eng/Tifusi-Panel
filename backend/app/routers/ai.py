from anthropic import AnthropicError, AuthenticationError
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.chat import run_chat
from app.database import get_db
from app.dependencies import get_current_admin
from app.schemas.ai import AiChatRequest, AiChatResponse
from app.settings_store import get_settings_row

router = APIRouter(prefix="/api/ai", tags=["ai"], dependencies=[Depends(get_current_admin)])


@router.post("/chat", response_model=AiChatResponse)
async def chat(payload: AiChatRequest, db: AsyncSession = Depends(get_db)) -> AiChatResponse:
    settings_row = await get_settings_row(db)
    if not settings_row.ai_api_key:
        raise HTTPException(status_code=400, detail="Set an Anthropic API key in Settings first")

    conversation = [{"role": m.role, "content": m.content} for m in payload.messages]
    try:
        result = await run_chat(conversation, settings_row.ai_api_key, db)
    except AuthenticationError as exc:
        raise HTTPException(
            status_code=502, detail="Anthropic rejected the API key — check it in Settings"
        ) from exc
    except AnthropicError as exc:
        raise HTTPException(status_code=502, detail=f"Anthropic API request failed: {exc}") from exc
    return AiChatResponse(reply=result.reply, actions=result.actions)
