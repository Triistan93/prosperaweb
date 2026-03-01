# Usa a imagem oficial do Nginx (Alpine é a versão mais leve e segura)
FROM nginx:alpine

# Remove a página padrão do Nginx
RUN rm -rf /usr/share/nginx/html/*

# Copia o seu arquivo HTML para a pasta pública do servidor web
COPY ./index.html /usr/share/nginx/html/index.html

# Expõe a porta 80 (Padrão para tráfego web)
EXPOSE 80

# Inicia o Nginx em primeiro plano
CMD ["nginx", "-g", "daemon off;"]
