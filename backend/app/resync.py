import json
import logging

from app.config import Settings
from app.database import connect
from app.service import Journal


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    with connect(Settings.from_environment()) as storage:
        counts = Journal(storage).resync()
        print(json.dumps(counts))


if __name__ == "__main__":
    main()
