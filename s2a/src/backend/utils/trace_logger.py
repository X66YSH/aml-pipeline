"""Agent execution trace logger.

Captures step-by-step agent actions for real-time SSE streaming.
"""

import time
from dataclasses import dataclass, field
from enum import Enum


class TraceLevel(str, Enum):
    INFO = "info"
    AGENT = "agent"
    TOOL = "tool"
    ERROR = "error"
    SUCCESS = "success"


@dataclass
class TraceEvent:
    """A single trace event in the agent execution."""

    timestamp: float
    level: TraceLevel
    agent: str
    message: str
    data: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "level": self.level.value,
            "agent": self.agent,
            "message": self.message,
            "data": self.data,
        }


class TraceLogger:
    """Collects trace events during a pipeline run."""

    def __init__(self) -> None:
        self.events: list[TraceEvent] = []
        self._start_time = time.time()

    def log(
        self,
        level: TraceLevel,
        agent: str,
        message: str,
        data: dict | None = None,
    ) -> TraceEvent:
        event = TraceEvent(
            timestamp=time.time() - self._start_time,
            level=level,
            agent=agent,
            message=message,
            data=data or {},
        )
        self.events.append(event)
        return event

    def info(self, agent: str, message: str, **data) -> TraceEvent:
        return self.log(TraceLevel.INFO, agent, message, data)

    def agent(self, agent: str, message: str, **data) -> TraceEvent:
        return self.log(TraceLevel.AGENT, agent, message, data)

    def tool(self, agent: str, message: str, **data) -> TraceEvent:
        return self.log(TraceLevel.TOOL, agent, message, data)

    def error(self, agent: str, message: str, **data) -> TraceEvent:
        return self.log(TraceLevel.ERROR, agent, message, data)

    def success(self, agent: str, message: str, **data) -> TraceEvent:
        return self.log(TraceLevel.SUCCESS, agent, message, data)

    def to_list(self) -> list[dict]:
        return [e.to_dict() for e in self.events]
