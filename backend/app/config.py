import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    DATABASE_URL: str = os.getenv("DATABASE_URL", "file:./dev.db")
    TOSS_SECRET_KEY: str = os.getenv("TOSS_SECRET_KEY", "")
    TOSS_WEBHOOK_SECRET: str = os.getenv("TOSS_WEBHOOK_SECRET", "")
    CORS_ORIGINS: list[str] = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

settings = Settings()