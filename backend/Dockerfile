# Usa uma imagem oficial do Python, versão slim para otimização
FROM python:3.11-slim

# Define o diretório de trabalho dentro do container
WORKDIR /code

# Variáveis de ambiente para otimizar o Python no Docker
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Copia o arquivo de dependências (criaremos no próximo passo)
COPY ./requirements.txt /code/requirements.txt

# Instala as dependências sem armazenar cache para manter a imagem leve
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

# Copia o código da aplicação
COPY ./app /code/app

# Expõe a porta que o FastAPI vai rodar
EXPOSE 8000

# Comando de inicialização usando Uvicorn (Servidor ASGI de alta performance)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
