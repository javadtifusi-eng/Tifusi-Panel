from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserDeviceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    identifier: str
    label: str | None
    first_seen: datetime
    last_seen: datetime
