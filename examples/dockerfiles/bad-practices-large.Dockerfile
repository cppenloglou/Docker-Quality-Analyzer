# Intentionally bad Dockerfile with many anti-patterns
# Expect: very low score, many errors/warnings/security issues
FROM ubuntu:latest

MAINTAINER deprecated@example.com

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update
RUN apt-get install -y curl wget git openssh-server
RUN apt-get install -y python3 python3-pip python3-dev
RUN apt-get install -y nodejs npm
RUN apt-get install -y build-essential gcc g++ make
RUN apt-get install -y vim nano less htop strace
RUN apt-get install -y mysql-client postgresql-client
RUN apt-get install -y redis-tools
RUN apt-get install -y nginx apache2
RUN apt-get install -y sudo

RUN echo "root:password123" | chpasswd
RUN echo "PermitRootLogin yes" >> /etc/ssh/sshd_config

ENV DATABASE_PASSWORD=supersecret123
ENV AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
ENV STRIPE_SECRET_KEY=sk_live_abc123xyz789
ENV JWT_SECRET=my-jwt-secret-dont-share

ADD https://example.com/app.tar.gz /tmp/
RUN cd /tmp && tar -xzf app.tar.gz && mv app /opt/app

RUN pip3 install flask django requests boto3 sqlalchemy celery redis \
    numpy pandas scipy scikit-learn tensorflow torch transformers \
    pillow opencv-python matplotlib seaborn plotly dash \
    fastapi uvicorn pydantic alembic psycopg2-binary \
    beautifulsoup4 scrapy selenium playwright

COPY . /app
WORKDIR /app

RUN npm install
RUN npm install -g nodemon pm2 typescript ts-node webpack babel-cli

RUN chmod 777 /app
RUN chmod 777 /tmp
RUN chmod -R 777 /var/log

RUN mkdir -p /root/.ssh
COPY id_rsa /root/.ssh/id_rsa
RUN chmod 600 /root/.ssh/id_rsa

EXPOSE 22 80 443 3000 3306 5432 6379 8080 8443 9090

VOLUME ["/app/data", "/var/log", "/tmp"]

RUN service ssh start
RUN service nginx start

CMD service ssh start && service nginx start && python3 /app/main.py && node /app/server.js && tail -f /dev/null
