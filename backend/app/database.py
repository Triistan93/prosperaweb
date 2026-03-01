# database.py
import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Configuração dinâmica baseada em variáveis de ambiente, com fallback seguro
DB_USER = os.getenv("DB_USER", "admin")
DB_PASSWORD = os.getenv("DB_PASSWORD", "secret")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "prosperadb")

# A URI de conexão adota o padrão genérico. A alteração de "postgresql" para "mysql+pymysql"
# é suficiente para transmutar todo o sistema sem alterações nas queries de negócios.
SQLALCHEMY_DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

# Configuração do Engine com pool de conexões (pool_size e max_overflow) otimizado para alta carga
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True  # Verifica a vitalidade da conexão antes de usá-la
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    """
    Injeção de dependência para instanciar e encerrar transações do banco de dados
    assegurando liberação de memória em caso de exceções HTTP.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()