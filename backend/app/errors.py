from fastapi import Request
from fastapi.responses import JSONResponse


class DomainError(Exception):
    """An error with a stable code and a message a person can read.

    Errors are sentences: "You can send up to BDT 100,000 per transfer",
    never a raw validation dump.
    """

    def __init__(self, code: str, message: str, status_code: int = 400, **extra):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.extra = extra

    def body(self, trace_id: str) -> dict:
        payload = {"code": self.code, "message": self.message, "traceId": trace_id}
        payload.update(self.extra)
        return {"error": payload}


def unauthenticated(msg="Sign in to continue."):
    return DomainError("UNAUTHENTICATED", msg, 401)


def not_found(code: str, msg: str):
    return DomainError(code, msg, 404)


async def domain_error_handler(request: Request, exc: DomainError):
    trace_id = getattr(request.state, "trace_id", "-")
    return JSONResponse(status_code=exc.status_code, content=exc.body(trace_id))
