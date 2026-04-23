from abc import ABC, abstractmethod
from typing import Any


class BasePlugin(ABC):
    name: str

    @abstractmethod
    async def run(self, context: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError
