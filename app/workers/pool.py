import asyncio
from concurrent.futures import ThreadPoolExecutor

from app.config import settings

_executor: ThreadPoolExecutor | None = None
_job_queue: asyncio.Queue[str] | None = None
_workers_started = False


def get_executor() -> ThreadPoolExecutor:
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(max_workers=settings.worker_count, thread_name_prefix="nuvoletro")
    return _executor


def get_queue() -> asyncio.Queue[str]:
    global _job_queue
    if _job_queue is None:
        _job_queue = asyncio.Queue()
    return _job_queue


async def enqueue_job(job_id: str) -> None:
    await get_queue().put(job_id)


async def start_workers() -> None:
    global _workers_started
    if _workers_started:
        return
    _workers_started = True
    from app.services.jobs import run_job_sync

    queue = get_queue()
    executor = get_executor()
    loop = asyncio.get_running_loop()

    async def worker(worker_id: int) -> None:
        while True:
            job_id = await queue.get()
            try:
                await loop.run_in_executor(executor, run_job_sync, job_id)
            except Exception:  # noqa: BLE001 — job handler records failures
                pass
            finally:
                queue.task_done()

    for i in range(settings.worker_count):
        asyncio.create_task(worker(i))
