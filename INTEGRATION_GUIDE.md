# Guia de Integração Frontend <-> Backend

O backend está pronto em Python (FastAPI). Para conectar o `index.html` (React) a ele, siga os passos abaixo.

## 1. Testar o Backend Localmente

1.  Navegue até a pasta `backend/`:
    ```bash
    cd backend
    ```
2.  Instale as dependências:
    ```bash
    pip install -r requirements.txt
    ```
3.  Inicie o servidor:
    ```bash
    uvicorn app.main:app --reload
    ```
    O servidor rodará em `http://localhost:8000`. Você pode ver a documentação interativa em `http://localhost:8000/docs`.

## 2. Implantação no Easypanel (Hostinger)

1.  Crie um novo **Application Service**.
2.  Selecione a fonte como **Github** (este repositório) e aponte o **Build Path** para `/backend`.
3.  Ou use o **Dockerfile** fornecido se for fazer upload manual.
4.  Crie um serviço **PostgreSQL** no Easypanel.
5.  Nas variáveis de ambiente do seu App Python, adicione:
    *   `DATABASE_URL`: `postgresql://user:password@host:5432/dbname` (Pegue esses dados no serviço Postgres do Easypanel).
    *   `SECRET_KEY`: Crie uma senha longa e aleatória para assinar os tokens.

## 3. Alterações Necessárias no Frontend (`index.html`)

Atualmente, o frontend usa `localStorage`. Para usar a API:

1.  **Substituir Login**:
    *   Remover a lógica de `PIN`.
    *   Criar um formulário de Login (Email/Senha) que faz POST para `/token`.
    *   Salvar o `access_token` retornado no `localStorage`.

2.  **Substituir Carregamento de Dados**:
    *   Ao iniciar o App, verificar se tem token.
    *   Fazer GET para `/transactions/`, `/users/me`.
    *   Preencher o estado do React (`setTransactions`, `setUser`).

3.  **Substituir Salvamento de Dados**:
    *   Ao criar transação: Fazer POST para `/transactions/`.
    *   Ao deletar: Fazer DELETE para `/transactions/{id}`.

### Exemplo de código para o Frontend

```javascript
const API_URL = "https://seu-app-no-easypanel.com"; // ou http://localhost:8000 localmente

// Login
const login = async (email, password) => {
  const formData = new FormData();
  formData.append('username', email); // FastAPI OAuth2 espera 'username'
  formData.append('password', password);
  
  const res = await fetch(`${API_URL}/token`, { method: 'POST', body: formData });
  const data = await res.json();
  if (data.access_token) {
    localStorage.setItem('token', data.access_token);
    return true;
  }
  return false;
};

// Fetch Transações
const fetchTransactions = async () => {
  const token = localStorage.getItem('token');
  const res = await fetch(`${API_URL}/transactions/`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return await res.json();
};
```
