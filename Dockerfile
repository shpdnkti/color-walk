FROM nginx:stable-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY src/ /usr/share/nginx/html/src/
RUN chmod -R a+rX /usr/share/nginx/html /etc/nginx/conf.d/default.conf

EXPOSE 80
