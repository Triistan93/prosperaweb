from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from jose import JWTError, jwt
import hashlib
import os

from . import models, database

# --- Configurações de Segurança ---
# O Pepper atua como um "salt global". No Easypanel, defina PROSPERA_PEPPER nas variáveis de ambiente.
PEPPER = os.getenv("PROSPERA_PEPPER", "chave_secreta_padrao_muito_longa_123")
SECRET_KEY = os.getenv("SECRET_KEY", "jwt_secret_key_prospera")
ALGORITHM = "HS256"

def hash_pin(pin: str) -> str:
    """Hash determinístico O(1) protegido por Pepper"""
    return hashlib.sha256((pin + PEPPER).encode()).hexdigest()

# --- Schemas Pydantic ---
class AuthRequest(BaseModel):
    pin: str
    name: str = None # Necessário apenas no registro

# --- Setup da Aplicação ---
models.Base.metadata.create_all(bind=database.engine)
app = FastAPI(title="Prospera Core API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # No Easypanel, restrinja isso ao domínio do frontend posteriormente
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(database.get_db)):
    credentials_exception = HTTPException(status_code=401, detail="Token inválido ou expirado")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: int = payload.get("sub")
        if user_id is None: raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = db.query(models.User).filter(models.User.id == int(user_id)).first()
    if user is None: raise credentials_exception
    return user

# --- Rotas de Autenticação ---
@app.post("/api/auth/register")
def register(req: AuthRequest, db: Session = Depends(database.get_db)):
    if not req.name or not req.pin:
        raise HTTPException(status_code=400, detail="Nome e PIN obrigatórios")
    
    pin_hashed = hash_pin(req.pin)
    if db.query(models.User).filter(models.User.pin_hash == pin_hashed).first():
        raise HTTPException(status_code=409, detail="Este PIN já está em uso.")
    
    new_user = models.User(name=req.name, pin_hash=pin_hashed)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    token = jwt.encode({"sub": str(new_user.id)}, SECRET_KEY, algorithm=ALGORITHM)
    return {"user": {"id": new_user.id, "name": new_user.name}, "access_token": token}

@app.post("/api/auth/login")
def login(req: AuthRequest, db: Session = Depends(database.get_db)):
    pin_hashed = hash_pin(req.pin)
    user = db.query(models.User).filter(models.User.pin_hash == pin_hashed).first()
    
    if not user:
        raise HTTPException(status_code=401, detail="PIN incorreto ou não registrado.")
    
    token = jwt.encode({"sub": str(user.id)}, SECRET_KEY, algorithm=ALGORITHM)
    return {"user": {"id": user.id, "name": user.name}, "access_token": token}

# --- Exemplo de Rota Segura (Transações) ---
@app.get("/api/transactions")
def get_transactions(db: Session = Depends(database.get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.Transaction).filter(models.Transaction.user_id == current_user.id).all()

from fastapi import Request # Adicione isso nos imports lá em cima se não houver

# --- ROTAS DE NEGÓCIO (CRUD) ---

# 1. TRANSAÇÕES
@app.get("/api/transactions")
def get_transactions(db: Session = Depends(database.get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.Transaction).filter(models.Transaction.user_id == current_user.id).order_by(models.Transaction.date.desc()).all()

@app.post("/api/transactions")
async def create_transaction(request: Request, db: Session = Depends(database.get_db), current_user: models.User = Depends(get_current_user)):
    data = await request.json()
    new_item = models.Transaction(**data, user_id=current_user.id)
    db.add(new_item)
    db.commit()
    db.refresh(new_item)
    return new_item

@app.put("/api/transactions/{item_id}")
async def update_transaction(item_id: int, request: Request, db: Session = Depends(database.get_db), current_user: models.User = Depends(get_current_user)):
    data = await request.json()
    db.query(models.Transaction).filter(models.Transaction.id == item_id, models.Transaction.user_id == current_user.id).update(data)
    db.commit()
    return {"status": "updated"}

@app.delete("/api/transactions/{item_id}")
def delete_transaction(item_id: int, db: Session = Depends(database.get_db), current_user: models.User = Depends(get_current_user)):
    db.query(models.Transaction).filter(models.Transaction.id == item_id, models.Transaction.user_id == current_user.id).delete()
    db.commit()
    return {"status": "deleted"}

# 2. METAS (GOALS)
@app.get("/api/goals")
def get_goals(db: Session = Depends(database.get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.Goal).filter(models.Goal.user_id == current_user.id).all()

@app.post("/api/goals")
async def create_goal(request: Request, db: Session = Depends(database.get_db), current_user: models.User = Depends(get_current_user)):
    data = await request.json()
    new_item = models.Goal(**data, user_id=current_user.id)
    db.add(new_item)
    db.commit()
    return new_item

@app.put("/api/goals/{item_id}")
async def update_goal(item_id: int, request: Request, db: Session = Depends(database.get_db), current_user: models.User = Depends(get_current_user)):
    data = await request.json()
    db.query(models.Goal).filter(models.Goal.id == item_id, models.Goal.user_id == current_user.id).update(data)
    db.commit()
    return {"status": "updated"}

@app.delete("/api/goals/{item_id}")
def delete_goal(item_id: int, db: Session = Depends(database.get_db), current_user: models.User = Depends(get_current_user)):
    db.query(models.Goal).filter(models.Goal.id == item_id, models.Goal.user_id == current_user.id).delete()
    db.commit()
    return {"status": "deleted"}

# 3. INVESTIMENTOS
@app.get("/api/investments")
def get_investments(db: Session = Depends(database.get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.Investment).filter(models.Investment.user_id == current_user.id).all()

@app.post("/api/investments")
async def create_investment(request: Request, db: Session = Depends(database.get_db), current_user: models.User = Depends(get_current_user)):
    data = await request.json()
    new_item = models.Investment(**data, user_id=current_user.id)
    db.add(new_item)
    db.commit()
    return new_item

@app.put("/api/investments/{item_id}")
async def update_investment(item_id: int, request: Request, db: Session = Depends(database.get_db), current_user: models.User = Depends(get_current_user)):
    data = await request.json()
    db.query(models.Investment).filter(models.Investment.id == item_id, models.Investment.user_id == current_user.id).update(data)
    db.commit()
    return {"status": "updated"}

@app.delete("/api/investments/{item_id}")
def delete_investment(item_id: int, db: Session = Depends(database.get_db), current_user: models.User = Depends(get_current_user)):
    db.query(models.Investment).filter(models.Investment.id == item_id, models.Investment.user_id == current_user.id).delete()
    db.commit()
    return {"status": "deleted"}

# 4. CARTÕES E ORÇAMENTOS (Leitura Rápida)
@app.get("/api/cards")
def get_cards(db: Session = Depends(database.get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.Card).filter(models.Card.user_id == current_user.id).all()

@app.get("/api/budgets")
def get_budgets(db: Session = Depends(database.get_db), current_user: models.User = Depends(get_current_user)):
    return db.query(models.Budget).filter(models.Budget.user_id == current_user.id).all()
