from alembic import context
from sqlalchemy import create_engine

from returnpilot.config import get_settings

settings = get_settings()


def run_migrations_offline() -> None:
    context.configure(url=settings.sqlalchemy_url, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(settings.sqlalchemy_url, connect_args={"prepare_threshold": None})
    with engine.connect() as connection:
        context.configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
