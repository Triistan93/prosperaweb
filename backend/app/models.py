# models.py
from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from database import Base

class User(Base):
    """
    Modelo ORM que mapeia a entidade de Usuário para a tabela correspondente no PostgreSQL/MySQL.
    Segue os princípios SOLID ao isolar as responsabilidades de persistência de identidade.
    """
    __tablename__ = "users"

    # A indexação da chave primária garante tempo de busca O(1) em pesquisas diretas
    id = Column(Integer, primary_key=True, index=True)
    
    # Índices em colunas de alta concorrência nas queries de autenticação (username e email)
    # garantem a performance, reduzindo a necessidade de Full Table Scans.
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True, nullable=False)
    
    # O hash bcrypt requer tipicamente 60 caracteres. Alocamos 255 por precaução arquitetural
    # para permitir futuras migrações de algoritmos (ex: Argon2).
    hashed_password = Column(String(255), nullable=False)
    
    is_active = Column(Boolean, default=True)
    
    # Campos de auditoria para monitoramento contínuo de anomalias
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    
    # Estrutura para o novo fluxo de recuperação de senha (OTP/Magic Link)
    reset_token_hash = Column(String(255), nullable=True)
    reset_token_expiry = Column(DateTime(timezone=True), nullable=True)