from sqlalchemy import Column, Integer, String, Boolean, Numeric, ForeignKey, Date
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    pin_hash = Column(String(255), unique=True, index=True, nullable=False)
    created_at = Column(Date, server_default=func.now())

    transactions = relationship("Transaction", back_populates="owner", cascade="all, delete-orphan")
    investments = relationship("Investment", back_populates="owner", cascade="all, delete-orphan")
    goals = relationship("Goal", back_populates="owner", cascade="all, delete-orphan")
    cards = relationship("Card", back_populates="owner", cascade="all, delete-orphan")
    budgets = relationship("Budget", back_populates="owner", cascade="all, delete-orphan")

class Transaction(Base):
    __tablename__ = "transactions"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    description = Column(String(255), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    type = Column(String(50), nullable=False)
    category = Column(String(100))
    subcategory = Column(String(100))
    date = Column(String(50), nullable=False)
    paymentMethod = Column(String(50))
    isRecurring = Column(Boolean, default=False)
    cardId = Column(Integer, nullable=True)

    owner = relationship("User", back_populates="transactions")

class Investment(Base):
    __tablename__ = "investments"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    type = Column(String(50), nullable=False)
    value = Column(Numeric(15, 2), nullable=False)
    returnRate = Column(String(50))

    owner = relationship("User", back_populates="investments")

class Goal(Base):
    __tablename__ = "goals"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    target = Column(Numeric(15, 2), nullable=False)
    current = Column(Numeric(15, 2), default=0)
    color = Column(String(50))

    owner = relationship("User", back_populates="goals")

class Card(Base):
    __tablename__ = "cards"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    limit = Column(Numeric(15, 2), nullable=False)
    used = Column(Numeric(15, 2), default=0)
    dueDay = Column(Integer, nullable=False)
    color = Column(String(50))

    owner = relationship("User", back_populates="cards")

class Budget(Base):
    __tablename__ = "budgets"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    category = Column(String(100), nullable=False)
    limit = Column(Numeric(15, 2), nullable=False)

    owner = relationship("User", back_populates="budgets")
