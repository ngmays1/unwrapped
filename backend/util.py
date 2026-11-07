import os
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo(os.getenv("TZ", "UTC"))
