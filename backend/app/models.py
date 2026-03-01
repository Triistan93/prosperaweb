from sqlalchemy import Column, Integer, String, Boolean, DateTime, Numeric, ForeignKey, Date
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    # Utilizamos index=True pois o PIN será a chave de busca do login
    pin_hash = Column(String(255), unique=True, index=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relacionamentos (Cascade Delete)
    transactions = relationship("Transaction", back_populates="owner", cascade="all, delete-orphan")
    investments = relationship("Investment", back_populates="owner", cascade="all, delete-orphan")

class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    description = Column(String(255), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    type = Column(String(10), nullable=False) # 'income' ou 'expense'
    category = Column(String(50))
    subcategory = Column(String(50))
    date = Column(Date, nullable=False)
    payment_method = Column(String(50))
    is_recurring = Column(Boolean, default=False)
    card_id = Column(Integer, nullable=True)

    owner = relationship("User", back_populates="transactions")

class Investment(Base):
    __tablename__ = "investments"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    type = Column(String(50), nullable=False)
    value_amount = Column(Numeric(15, 2), nullable=False)
    return_rate = Column(String(50))

    owner = relationship("User", back_populates="investments")

# NOTA PARA O EDUARDO: Para manter o código limpo, siga esta mesma 
# estrutura para as classes Goal, Card e Budget.
